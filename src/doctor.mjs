import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

export async function diagnose(selected, { root }) {
  const checks = [];
  checks.push(await fileCheck('Playwright Chromium', chromium.executablePath(), '运行 pnpm exec playwright install chromium'));

  const testAgentDir = path.resolve(process.env.FRONTEND_TEST_AGENT_DIR || path.join(root, '..', 'frontend-test-agent'));
  checks.push(await fileCheck('Test Agent联动', path.join(testAgentDir, 'src/cli.mjs'), '可选：把frontend-test-agent放在同级目录'));

  for (const [key, project] of selected) {
    checks.push(await directoryCheck(`${key} 项目目录`, project.root, '修改 config/projects.local.json 中的root'));
    checks.push(await urlCheck(`${key} 页面服务`, project.url, `先启动项目：${project.startCommand || '未配置startCommand'}`));
    checks.push(await authCheck(`${key} 登录状态`, path.join(root, '.auth', `${key}.json`), `需要登录后执行 pnpm run auth -- ${key}`));
  }
  return checks;
}

export function printDiagnosis(checks) {
  for (const check of checks) {
    const icon = check.status === 'ok' ? 'OK' : check.status === 'optional' ? 'INFO' : 'FAIL';
    console.log(`[${icon}] ${check.name}：${check.message}`);
  }
  const failures = checks.filter((item) => item.status === 'fail').length;
  console.log(`诊断完成：${failures}项需要处理。`);
  return failures;
}

async function fileCheck(name, file, suggestion) {
  try { await fs.access(file); return { name, status: 'ok', message: file }; }
  catch { return { name, status: name.startsWith('Test Agent') ? 'optional' : 'fail', message: suggestion }; }
}

async function directoryCheck(name, directory, suggestion) {
  try {
    const stat = await fs.stat(directory);
    if (stat.isDirectory()) return { name, status: 'ok', message: directory };
  } catch { /* handled below */ }
  return { name, status: 'fail', message: `${suggestion}（当前：${directory}）` };
}

async function urlCheck(name, url, suggestion) {
  if (!url) return { name, status: 'fail', message: '项目没有配置url' };
  try {
    await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(3500) });
    return { name, status: 'ok', message: url };
  } catch {
    return { name, status: 'fail', message: `${url}无法访问；${suggestion}` };
  }
}

async function authCheck(name, file, suggestion) {
  try {
    const state = JSON.parse(await fs.readFile(file, 'utf8'));
    if (state.cookies?.length || state.origins?.some((item) => item.localStorage?.length)) {
      return { name, status: 'ok', message: '已保存本地登录状态' };
    }
  } catch { /* handled below */ }
  return { name, status: 'optional', message: suggestion };
}
