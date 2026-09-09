#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadProjects, projectRoot, selectProjects } from './config.mjs';
import { scanProject } from './rules/static-rules.mjs';
import { auditRuntime, captureAuth } from './runtime/browser-audit.mjs';
import { auditInteractive } from './runtime/interactive-audit.mjs';
import { writeReport } from './report/html.mjs';
import { historySummary, reconcileFindings, updateDecision } from './history.mjs';
import { nowSlug } from './utils.mjs';
import { changedSourceFiles } from './utils.mjs';
import { diagnose, printDiagnosis } from './doctor.mjs';

const [command = 'scan', selector = 'all', ...flags] = process.argv.slice(2);
const projects = await loadProjects();
const root = projectRoot();
const stateFile = path.join(root, 'state', 'findings.json');

if (command === 'decide') {
  const [findingId, status, ...reasonParts] = [selector, ...flags];
  const record = await updateDecision(stateFile, findingId, status, reasonParts.join(' '));
  console.log(`${record.findingId} 已更新为 ${record.status}${record.reason ? `：${record.reason}` : ''}`);
  process.exit(0);
}

if (command === 'history') {
  const summary = await historySummary(stateFile, selector);
  console.log('状态统计：', summary.counts);
  summary.records.slice(0, 50).forEach((item) => console.log(`${item.findingId}\t${item.status}\t${item.project}\t${item.ruleId}\t${item.file || ''}`));
  process.exit(0);
}

const selected = selectProjects(projects, selector);

if (command === 'doctor') {
  const failures = printDiagnosis(await diagnose(selected, { root }));
  process.exitCode = failures ? 1 : 0;
  process.exit();
}

if (command === 'auth') {
  if (selected.length !== 1) throw new Error('auth命令必须指定一个项目：admin、mobile或screen');
  const [key, project] = selected[0];
  await captureAuth(key, project, path.join(root, '.auth'));
  console.log(`登录状态已保存：${key}`);
  process.exit(0);
}

if (command === 'interact') {
  if (selected.length !== 1) throw new Error('interact命令必须指定一个项目：admin、mobile或screen');
  const [key, project] = selected[0];
  const outputDir = path.join(root, 'output', nowSlug());
  await fs.mkdir(outputDir, { recursive: true });
  const policy = JSON.parse(await fs.readFile(path.join(root, 'config', 'ui-policy.json'), 'utf8'));
  const result = await auditInteractive(key, project, outputDir, path.join(root, '.auth'), policy);
  const tracked = await reconcileFindings(result.findings, {
    stateFile, projects: [key], scopes: ['runtime-interact'], scopeForFinding: () => 'runtime-interact',
  });
  const reportFile = await writeReport(outputDir, {
    generatedAt: new Date().toLocaleString('zh-CN'), command, projects, findings: tracked.active, suppressed: tracked.suppressed,
    newlyResolved: tracked.newlyResolved, observations: result.observations, artifacts: result.artifacts,
  });
  console.log(`完成：${tracked.active.length} 个交互发现，隐藏${tracked.suppressed.length}个已处理项，本次解决${tracked.newlyResolved}个`);
  console.log(`报告：${reportFile}`);
  process.exit(0);
}

const outputDir = path.join(root, 'output', nowSlug());
await fs.mkdir(outputDir, { recursive: true });
const findings = [];
const artifacts = [];

for (const [key, project] of selected) {
  console.log(`扫描 ${project.name}...`);
  const changedFiles = command === 'scan-changed' ? await changedSourceFiles(project.root) : undefined;
  if (changedFiles) console.log(`仅检查Git变更：${changedFiles.length}个源码文件`);
  findings.push(...await scanProject(key, project, { files: changedFiles }));
  if (command === 'audit') {
    const runtime = await auditRuntime(key, project, outputDir, { headed: flags.includes('--headed') });
    findings.push(...runtime.findings);
    artifacts.push(...runtime.artifacts);
  }
}

const reportFile = await writeReport(outputDir, {
  generatedAt: new Date().toLocaleString('zh-CN'),
  command,
  projects,
  ...await (async () => {
    const tracked = await reconcileFindings(findings, {
      stateFile,
      projects: selected.map(([key]) => key),
      scopes: command === 'audit' ? ['static', 'runtime-audit'] : ['static'],
      scopeForFinding: (finding) => finding.file ? 'static' : 'runtime-audit',
      resolveMissing: command !== 'scan-changed',
    });
    return { findings: tracked.active, suppressed: tracked.suppressed, newlyResolved: tracked.newlyResolved };
  })(),
  artifacts,
});
const savedReport = JSON.parse(await fs.readFile(path.join(outputDir, 'report.json'), 'utf8'));
console.log(`完成：${savedReport.findings.length} 个发现，隐藏${savedReport.suppressed?.length || 0}个已处理项，本次解决${savedReport.newlyResolved || 0}个`);
console.log(`报告：${reportFile}`);
