import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

export async function captureAuth(projectKey, project, authDir) {
  const browser = await launchChromium(false);
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(project.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  } catch (error) {
    await browser.close();
    throw new Error(`无法访问${project.url}。请先启动业务项目并确认config/projects.local.json中的url正确。原始错误：${error.message}`);
  }
  process.stdout.write(`\n请在打开的浏览器中登录 ${project.name}，登录完成后回到终端按 Enter。\n`);
  await waitForEnter();
  const state = await context.storageState();
  const hasState = state.cookies.length > 0 || state.origins.some((origin) => origin.localStorage.length > 0);
  if (!hasState) {
    await browser.close();
    throw new Error('没有捕获到Cookie或LocalStorage，请确认是在工具打开的浏览器中完成登录。');
  }
  await context.storageState({ path: path.join(authDir, `${projectKey}.json`) });
  await browser.close();
}

export async function auditRuntime(projectKey, project, outputDir, { headed = false } = {}) {
  const authPath = path.resolve(outputDir, '..', '..', '.auth', `${projectKey}.json`);
  const hasAuth = await hasUsefulAuth(authPath);
  const browser = await launchChromium(!headed);
  const context = await browser.newContext(hasAuth ? { storageState: authPath } : {});
  const findings = [];
  const artifacts = [];

  for (const viewport of project.viewports) {
    const page = await context.newPage({ viewport });
    const consoleErrors = [];
    const requestFailures = [];
    const httpErrors = [];
    const requestTimes = new Map();
    const responseStatuses = new Map();
    let loginDetected = false;

    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    page.on('requestfailed', (request) => requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`));
    page.on('response', (response) => {
      if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
      const signature = requestSignature(response.request());
      if (signature) {
        const statuses = responseStatuses.get(signature) || [];
        statuses.push(response.status());
        responseStatuses.set(signature, statuses);
      }
    });
    page.on('request', (request) => {
      const normalized = requestSignature(request);
      if (!normalized) return;
      const now = Date.now();
      const previous = requestTimes.get(normalized) || [];
      previous.push(now);
      requestTimes.set(normalized, previous);
    });

    for (const route of project.routes) {
      const targetUrl = new URL(route, project.url).toString();
      try {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(project.settleMs || 1800);
      } catch (error) {
        findings.push(runtimeFinding(projectKey, viewport.name, 'P1', 'PAGE_LOAD_FAILED', '页面加载失败', error.message, targetUrl));
      }

      const loginPage = await inspectLoginPage(page).catch(() => false);
      if (loginPage) {
        loginDetected = true;
        const finding = runtimeFinding(projectKey, viewport.name, 'P1', 'AUTH_REQUIRED', '巡检停留在登录页', `当前页面${page.url()}需要登录，无法继续验证登录后的业务功能。`, targetUrl);
        finding.suggestion = `先启动项目，再执行 pnpm run auth -- ${projectKey} 保存登录状态，然后重新运行巡检。`;
        findings.push(finding);
      }

      const dom = await inspectDom(page).catch(() => ({ overflow: [], occluded: [], brokenCharts: [] }));
      dom.overflow.slice(0, 12).forEach((item) => findings.push(runtimeFinding(projectKey, viewport.name, 'P2', 'HORIZONTAL_OVERFLOW', '元素横向溢出', item, targetUrl)));
      dom.occluded.slice(0, 12).forEach((item) => findings.push(runtimeFinding(projectKey, viewport.name, 'P1', 'CLICK_TARGET_OCCLUDED', '按钮或输入框被遮挡', item, targetUrl)));
      dom.brokenCharts.slice(0, 12).forEach((item) => findings.push(runtimeFinding(projectKey, viewport.name, 'P1', 'BROKEN_CHART_SIZE', '图表容器尺寸异常', item, targetUrl)));

      if (project.type === 'mobile-vue') {
        const keyboardIssue = await inspectKeyboardResize(page, viewport).catch(() => null);
        if (keyboardIssue) findings.push(runtimeFinding(projectKey, viewport.name, 'P1', 'KEYBOARD_INPUT_OCCLUSION', '软键盘缩屏后输入框不可见', keyboardIssue, targetUrl));
      }

      const screenshotName = `${projectKey}-${viewport.name}-${safeRoute(route)}.png`;
      const screenshotPath = path.join(outputDir, screenshotName);
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      artifacts.push({ project: projectKey, viewport: viewport.name, route, screenshot: screenshotName });
    }

    const authRequired = httpErrors.some((message) => message.startsWith('401 '));
    if (authRequired && !loginDetected) {
      findings.push(runtimeFinding(projectKey, viewport.name, 'P1', 'AUTH_REQUIRED', '运行态巡检缺少登录状态', '接口返回401；保存登录状态后才能判断页面真实问题。', project.url));
    }
    unique(consoleErrors)
      .filter((message) => !authRequired || !/(401|未授权|AxiosError)/i.test(message))
      .slice(0, 20)
      .forEach((message) => findings.push(runtimeFinding(projectKey, viewport.name, 'P1', 'CONSOLE_ERROR', '控制台错误', message, project.url)));
    unique(requestFailures).slice(0, 20).forEach((message) => findings.push(runtimeFinding(projectKey, viewport.name, 'P1', 'REQUEST_FAILED', '网络请求失败', message, project.url)));
    unique(httpErrors)
      .filter((message) => !authRequired || !message.startsWith('401 '))
      .slice(0, 20)
      .forEach((message) => findings.push(runtimeFinding(projectKey, viewport.name, 'P1', 'HTTP_ERROR', '接口返回错误状态', message, project.url)));
    for (const [signature, times] of requestTimes) {
      if (times.length < 2) continue;
      const statuses = responseStatuses.get(signature) || [];
      if (!statuses.some((status) => status >= 200 && status < 400)) continue;
      const clustered = times.some((time, index) => index > 0 && time - times[index - 1] < 1500);
      if (clustered) findings.push(runtimeFinding(projectKey, viewport.name, 'P2', 'DUPLICATE_REQUEST', '疑似重复接口请求', `${signature}，共${times.length}次`, project.url));
    }
    await page.close();
  }
  await browser.close();
  return { findings, artifacts };
}

async function launchChromium(headless) {
  try {
    return await chromium.launch({ headless });
  } catch (error) {
    throw new Error(`无法启动Playwright Chromium。请执行 pnpm exec playwright install chromium。原始错误：${error.message}`);
  }
}

async function inspectLoginPage(page) {
  const pathname = new URL(page.url()).pathname.toLowerCase();
  if (/(^|\/)(login|signin|sso)(\/|$)/.test(pathname)) return true;
  const passwordInputs = await page.locator('input[type="password"]:visible').count();
  if (passwordInputs > 0) return true;
  const text = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
  return /(登录|sign\s*in)/i.test(text) && /(密码|password|验证码|captcha)/i.test(text);
}

async function inspectDom(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const label = (element) => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${element.className && typeof element.className === 'string' ? `.${element.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}`;
    const overflow = [...document.querySelectorAll('body *')]
      .filter(visible)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < -4 || rect.right > innerWidth + 4;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return `${label(element)} left=${Math.round(rect.left)} right=${Math.round(rect.right)} viewport=${innerWidth}`;
      });
    const occluded = [...document.querySelectorAll('button, input, textarea, [role="button"], .ant-btn, .van-button')]
      .filter(visible)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const x = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2));
        const y = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2));
        const top = document.elementFromPoint(x, y);
        return top && top !== element && !element.contains(top) && !top.contains(element);
      })
      .map(label);
    const brokenCharts = [...document.querySelectorAll('canvas, [_echarts_instance_]')]
      .filter(visible)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width < 20 || rect.height < 20 || rect.right > innerWidth + 4;
      })
      .map((element) => `${label(element)} ${Math.round(element.getBoundingClientRect().width)}x${Math.round(element.getBoundingClientRect().height)}`);
    return { overflow, occluded, brokenCharts };
  });
}

async function inspectKeyboardResize(page, viewport) {
  const input = page.locator('input:visible, textarea:visible').first();
  if (await input.count() === 0) return null;
  await input.focus();
  await page.setViewportSize({ width: viewport.width, height: Math.min(500, viewport.height) });
  await page.waitForTimeout(150);
  const box = await input.boundingBox();
  await page.setViewportSize(viewport);
  if (box && box.y + box.height > Math.min(500, viewport.height)) {
    return `输入框底部=${Math.round(box.y + box.height)}，可视高度=${Math.min(500, viewport.height)}`;
  }
  return null;
}

function runtimeFinding(project, viewport, severity, ruleId, title, message, url) {
  return { project, viewport, severity, ruleId, title, message, url, evidence: message };
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    url.searchParams.delete('_t');
    return `${url.origin}${url.pathname}?${[...url.searchParams.entries()].sort().map(([k, v]) => `${k}=${v}`).join('&')}`;
  } catch {
    return value;
  }
}

function requestSignature(request) {
  if (!['xhr', 'fetch'].includes(request.resourceType())) return null;
  return `${request.method()} ${normalizeUrl(request.url())}`;
}

function unique(items) {
  return [...new Set(items)];
}

function safeRoute(route) {
  return route.replace(/[^a-zA-Z0-9]+/g, '-') || 'root';
}

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

async function hasUsefulAuth(file) {
  if (!await exists(file)) return false;
  try {
    const state = JSON.parse(await fs.readFile(file, 'utf8'));
    return state.cookies?.length > 0 || state.origins?.some((origin) => origin.localStorage?.length > 0);
  } catch {
    return false;
  }
}

function waitForEnter() {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', () => resolve());
  });
}
