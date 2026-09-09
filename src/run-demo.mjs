#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const selector = args[0] || 'demo';

if (selector !== 'demo') {
  process.exit(await run(process.execPath, [path.join(root, 'src/run-with-tests.mjs'), ...args], root));
}

const url = 'http://127.0.0.1:4178/';
let server;
if (!await reachable(url)) {
  server = spawn(process.execPath, [path.join(root, 'demo-project/server.mjs')], { cwd: path.join(root, 'demo-project'), stdio: 'inherit' });
  await waitUntilReady(url, server, 15000);
}

try {
  const configFile = path.join(root, 'config/projects.json');
  const code = await run(process.execPath, [path.join(root, 'src/run-with-tests.mjs'), 'demo', ...args.slice(1)], root, {
    FRONTEND_AUDIT_PROJECTS_FILE: configFile,
  });
  process.exitCode = code;
} finally {
  if (server && !server.killed) server.kill();
}

function run(command, commandArgs, cwd, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd, stdio: 'inherit', env: { ...process.env, ...extraEnv } });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

async function reachable(target) {
  try { await fetch(target, { method: 'HEAD', signal: AbortSignal.timeout(1000) }); return true; }
  catch { return false; }
}

async function waitUntilReady(target, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error('内置演示项目启动失败。');
    if (await reachable(target)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`等待内置演示项目超时：${target}`);
}
