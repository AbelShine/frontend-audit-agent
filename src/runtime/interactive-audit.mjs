import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

export async function auditInteractive(projectKey, project, outputDir, authDir, policy) {
  const authPath = path.join(authDir, `${projectKey}.json`);
  const state = await readUsefulState(authPath);
  if (!state) throw new Error(`缺少有效登录状态，请先执行 npm run auth -- ${projectKey}`);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: state });
  const page = await context.newPage({ viewport: project.viewports[0] });
  const requests = [];
  const reads = [];

  await page.addInitScript(() => {
    window.__frontendAuditToasts = [];
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          const notices = node.matches?.('.ant-message-notice, .ant-notification-notice')
            ? [node]
            : [...node.querySelectorAll?.('.ant-message-notice, .ant-notification-notice') || []];
          for (const notice of notices) {
            const text = notice.textContent?.trim();
            if (text) window.__frontendAuditToasts.push({ text, at: Date.now() });
          }
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });

  page.on('request', (request) => {
    if (!['xhr', 'fetch'].includes(request.resourceType())) return;
    if (request.method() === 'GET') reads.push({ url: request.url(), at: Date.now() });
  });

  await page.route('**/*', async (route) => {
    const request = route.request();
    if (!['xhr', 'fetch'].includes(request.resourceType())
      || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())
      || isAuthenticationRequest(request.url())
      || /\/login(?:[/?#]|$)/i.test(page.url())) {
      return route.continue();
    }
    const event = {
      method: request.method(), url: request.url(), startedAt: Date.now(), payload: parsePayload(request.postData()), loadingObserved: false,
    };
    requests.push(event);
    await delay(150);
    event.loadingObserved = await page.evaluate(() => Boolean(document.querySelector('.ant-btn-loading, .ant-spin-spinning, button[disabled], [aria-busy="true"]'))).catch(() => false);
    event.uiFindings = await inspectInteractiveUi(page, policy);
    await delay(750);
    event.completedAt = Date.now();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, code: 200, message: '巡检模拟成功', result: null }),
    });
  });

  await page.goto(new URL(project.routes[0], project.url).toString(), { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  process.stdout.write('\n请在浏览器完成：进入目标列表 → 筛选 → 全选/单选 → 打开操作弹窗 → 点击提交。\n写请求会被本工具拦截，不会修改真实数据。完成后回到终端按 Enter。\n');
  await waitForEnter();
  await delay(1800);

  const findings = [];
  const ui = await inspectInteractiveUi(page, policy);
  const uiFindings = dedupeUi([...requests.flatMap((request) => request.uiFindings || []), ...ui]);
  findings.push(...uiFindings.map((item) => finding(projectKey, item.severity, item.ruleId, item.title, item.message, page.url())));

  const toasts = await page.evaluate(() => window.__frontendAuditToasts || []).catch(() => []);
  let refreshCount = 0;
  for (const request of requests) {
    if (!request.loadingObserved) {
      findings.push(finding(projectKey, 'P1', 'REQUEST_WITHOUT_LOADING', '写请求期间未观察到loading', `${request.method} ${request.url}`, page.url()));
    }
    const refreshed = reads.some((read) => read.at > request.completedAt && read.at - request.completedAt < 5000);
    if (refreshed) refreshCount += 1;
    if (!refreshed) {
      findings.push(finding(projectKey, 'P2', 'LIST_NOT_REFRESHED_AFTER_MUTATION', '操作成功后未观察到列表刷新', `${request.method} ${request.url}`, page.url()));
    }
    const suspicious = suspiciousDefaults(request.payload);
    if (suspicious.length) {
      findings.push(finding(projectKey, 'P2', 'SUSPICIOUS_REQUEST_DEFAULT', '请求中存在疑似擅自补充的默认值', suspicious.join('、'), page.url()));
    }
  }

  const toastCounts = countBy(toasts.map((item) => item.text));
  for (const [message, count] of Object.entries(toastCounts)) {
    if (count > 1) findings.push(finding(projectKey, 'P1', 'DUPLICATE_MESSAGE_RUNTIME', '相同提示重复出现', `“${message}”出现${count}次`, page.url()));
  }

  const requestCounts = countBy(requests.map((item) => `${item.method} ${normalizeUrl(item.url)}`));
  for (const [signature, count] of Object.entries(requestCounts)) {
    if (count > 1) findings.push(finding(projectKey, 'P1', 'DUPLICATE_MUTATION_REQUEST', '写接口被重复提交', `${signature} 共${count}次`, page.url()));
  }

  if (!requests.length) {
    findings.push(finding(projectKey, 'P3', 'NO_MUTATION_OBSERVED', '本次未观察到提交请求', '可重新运行并在弹窗中完成一次提交，以验证loading、重复提示和刷新链路。', page.url()));
  }

  const finalUrl = page.url();
  const screenshotName = `${projectKey}-interaction.png`;
  await page.screenshot({ path: path.join(outputDir, screenshotName), fullPage: true });
  await browser.close();
  return {
    findings,
    observations: [
      { label: '写请求', value: requests.length, note: '均已模拟拦截' },
      { label: '观察到loading', value: requests.filter((request) => request.loadingObserved).length, note: `共${requests.length}次写请求` },
      { label: '操作后列表刷新', value: refreshCount, note: `共${requests.length}次写请求` },
      { label: '提示事件', value: toasts.length, note: '包含message与notification' },
      { label: '重复写请求', value: Object.values(requestCounts).filter((count) => count > 1).length, note: '按方法和接口归一化' },
    ],
    artifacts: [{ project: projectKey, viewport: 'interactive', route: finalUrl, screenshot: screenshotName }],
  };
}

async function inspectInteractiveUi(page, policy) {
  return page.evaluate((policyValue) => {
    const results = [];
    for (const table of document.querySelectorAll('.ant-table-wrapper')) {
      const rows = [...table.querySelectorAll('tbody tr')].filter((row) => row.getBoundingClientRect().height > 0);
      if (!table.querySelector('input[type="checkbox"], input[type="radio"]')) continue;
      const keys = rows.map((row) => row.getAttribute('data-row-key'));
      if (keys.some((key) => !key) || new Set(keys).size !== keys.length) {
        results.push({ severity: 'P1', ruleId: 'TABLE_ROW_KEY_RUNTIME', title: '表格行key缺失或重复', message: `可见行${rows.length}条，有效唯一key${new Set(keys.filter(Boolean)).size}个。` });
      }
    }
    for (const modal of document.querySelectorAll('.ant-modal, .ant-modal-confirm')) {
      if (modal.getBoundingClientRect().height <= 0) continue;
      const footer = modal.querySelector('.ant-modal-footer, .ant-modal-confirm-btns');
      if (!footer) continue;
      const buttons = [...footer.querySelectorAll('button')].filter((button) => button.getBoundingClientRect().width > 0);
      const modalRect = modal.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      const broken = footer.scrollWidth > footer.clientWidth + 2 || buttons.some((button) => {
        const rect = button.getBoundingClientRect();
        return rect.left < footerRect.left - 2 || rect.right > footerRect.right + 2;
      });
      if (broken) results.push({ severity: 'P1', ruleId: 'MODAL_FOOTER_COLLAPSE', title: '弹窗按钮区域发生溢出或塌陷', message: `弹窗宽${Math.round(modalRect.width)}px，按钮${buttons.length}个。` });
      const widthKey = String(Math.min(4, Math.max(1, buttons.length)));
      const minWidth = policyValue.modalMinWidthByButtonCount[widthKey];
      if (buttons.length && modalRect.width < minWidth) {
        results.push({ severity: 'P2', ruleId: 'MODAL_WIDTH_BY_BUTTON_COUNT', title: '弹窗宽度不足以容纳当前操作按钮', message: `${buttons.length}个按钮建议至少${minWidth}px，当前${Math.round(modalRect.width)}px。` });
      }
      const colors = buttons.map((button) => getComputedStyle(button).backgroundColor).filter((color) => color && color !== 'rgba(0, 0, 0, 0)');
      if (buttons.length >= 3 && new Set(colors).size < Math.min(3, buttons.length)) {
        results.push({ severity: 'P2', ruleId: 'OPERATION_BUTTON_COLOR_COLLISION', title: '多个操作按钮缺少独立语义颜色', message: `${buttons.length}个按钮仅检测到${new Set(colors).size}种背景色。` });
      }
    }
    return results;
  }, policy).catch(() => []);
}

function suspiciousDefaults(payload, prefix = '') {
  if (!payload || typeof payload !== 'object') return [];
  const results = [];
  for (const [key, value] of Object.entries(payload)) {
    const field = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') results.push(...suspiciousDefaults(value, field));
    if (/(?:id|code|status|type|level)$/i.test(key) && (value === '' || value === 0 || value === '0')) results.push(`${field}=${JSON.stringify(value)}`);
  }
  return results;
}

function parsePayload(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return value; }
}

function normalizeUrl(value) {
  try { const url = new URL(value); url.searchParams.delete('_t'); return `${url.origin}${url.pathname}`; } catch { return value; }
}

function isAuthenticationRequest(value) {
  try {
    const pathname = new URL(value).pathname;
    return /(?:^|\/)(?:login|logout|token|oauth|sso|captcha|randomImage|checkCaptcha|phoneLogin|mLogin)(?:\/|$)/i.test(pathname);
  } catch {
    return /(login|token|oauth|captcha|randomImage)/i.test(value);
  }
}

function countBy(items) {
  return items.reduce((result, item) => { result[item] = (result[item] || 0) + 1; return result; }, {});
}

function dedupeUi(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.ruleId}:${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function finding(project, severity, ruleId, title, message, url) {
  return { project, severity, ruleId, title, message, evidence: message, url, viewport: 'interactive' };
}

async function readUsefulState(file) {
  try {
    const state = JSON.parse(await fs.readFile(file, 'utf8'));
    return state.cookies?.length || state.origins?.some((origin) => origin.localStorage?.length) ? state : null;
  } catch { return null; }
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function waitForEnter() { return new Promise((resolve) => { process.stdin.resume(); process.stdin.once('data', resolve); }); }
