import fs from 'node:fs/promises';
import path from 'node:path';
import { escapeHtml } from '../utils.mjs';

export async function writeReport(outputDir, report) {
  await fs.mkdir(outputDir, { recursive: true });
  const file = path.join(outputDir, 'index.html');
  await fs.writeFile(file, render(report), 'utf8');
  await fs.writeFile(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  return file;
}

function render(report) {
  const counts = ['P0', 'P1', 'P2', 'P3'].map((severity) => [severity, report.findings.filter((item) => item.severity === severity).length]);
  const groups = Object.entries(groupBy(report.findings, (item) => item.project));
  const ruleCounts = Object.entries(groupBy(report.findings, (item) => item.ruleId))
    .map(([ruleId, items]) => [ruleId, items.length])
    .sort((a, b) => b[1] - a[1]);
  const observations = report.observations || [];
  const suppressed = report.suppressed || [];
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>前端交付巡检报告</title><style>
:root{font-family:Inter,"PingFang SC",sans-serif;background:#0b1020;color:#e9edff}*{box-sizing:border-box}body{margin:0}.shell{max-width:1220px;margin:auto;padding:48px 24px}.eyebrow{color:#80a4ff;letter-spacing:.15em;font-size:12px}h1{font-size:44px;margin:8px 0}.meta{color:#8790ad}.notice{border-left:3px solid #80a4ff;background:#111a31;padding:14px 18px;border-radius:8px;line-height:1.65}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:28px 0}.card,.finding,.shot,.rules{background:#141b30;border:1px solid #25304e;border-radius:15px;padding:18px}.card strong{display:block;font-size:30px}.P0{color:#ff5d77}.P1{color:#ff926b}.P2{color:#f5cf66}.P3{color:#79c9ff}.rules{display:flex;gap:10px;flex-wrap:wrap}.rules span{background:#202a46;padding:7px 10px;border-radius:999px;font-family:monospace;font-size:12px}.finding{margin:10px 0}.head{display:flex;gap:10px;align-items:center}.pill{font-weight:800}.rule{color:#7f8db5;font-size:12px}.where{color:#91a0c8;font-family:monospace;font-size:12px}.message{line-height:1.65}.suggestion{color:#9fb2e8}.shots{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.shot img{width:100%;border-radius:8px}.empty{color:#8790ad}@media(max-width:800px){.cards,.shots{grid-template-columns:1fr 1fr}h1{font-size:34px}}
</style></head><body><main class="shell"><p class="eyebrow">FRONTEND DELIVERY RADAR</p><h1>前端交付巡检报告</h1>
<p class="meta">生成时间 ${escapeHtml(report.generatedAt)} · ${report.findings.length} 个待处理 · ${suppressed.length} 个已隐藏 · ${report.newlyResolved || 0} 个本次解决 · ${report.artifacts.length} 张截图</p>
<p class="notice">本报告展示的是候选风险，不等同于已经确认的 Bug。P1 建议优先复现；P2 进入本次迭代核查；P3 用于统一规范时参考。</p>
<section class="cards">${counts.map(([s,c])=>`<div class="card"><span class="${s}">${s}</span><strong>${c}</strong><span class="meta">条问题</span></div>`).join('')}</section>
${observations.length ? `<section><h2>交互证据</h2><div class="cards">${observations.map((item)=>`<div class="card"><span class="meta">${escapeHtml(item.label)}</span><strong>${escapeHtml(String(item.value))}</strong><span class="meta">${escapeHtml(item.note || '')}</span></div>`).join('')}</div></section>` : ''}
<section><h2>规则分布</h2><div class="rules">${ruleCounts.map(([ruleId,count])=>`<span>${escapeHtml(ruleId)} · ${count}</span>`).join('')}</div></section>
${groups.map(([project, findings])=>`<section><h2>${escapeHtml(report.projects[project]?.name || project)}</h2>${findings.map(renderFinding).join('')}</section>`).join('') || '<p class="empty">没有发现问题。</p>'}
${report.artifacts.length ? `<section><h2>运行截图</h2><div class="shots">${report.artifacts.map((item)=>`<article class="shot"><img src="${escapeHtml(item.screenshot)}"><p>${escapeHtml(item.project)} · ${escapeHtml(item.viewport)} · ${escapeHtml(item.route)}</p></article>`).join('')}</div></section>` : ''}
</main></body></html>`;
}

function renderFinding(item) {
  const location = item.file ? `${item.file}:${item.line}` : `${item.viewport || ''} ${item.url || ''}`;
  return `<article class="finding"><div class="head"><span class="pill ${item.severity}">${item.severity}</span><strong>${escapeHtml(item.title)}</strong><span class="rule">${escapeHtml(item.ruleId)}</span><span class="rule">${escapeHtml(item.findingId || '')}${item.regression ? ' · 回归' : ''}</span></div>
  <p class="where">${escapeHtml(location)}</p><p class="message">${escapeHtml(item.message)}</p>${item.suggestion ? `<p class="suggestion">建议：${escapeHtml(item.suggestion)}</p>` : ''}</article>`;
}

function groupBy(items, key) {
  return items.reduce((result, item) => {
    const group = key(item);
    (result[group] ||= []).push(item);
    return result;
  }, {});
}
