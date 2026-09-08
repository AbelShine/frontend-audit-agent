#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [selector = 'all', ...flags] = process.argv.slice(2);

const auditCode = await run(process.execPath, [path.join(root, 'src/cli.mjs'), 'audit', selector, ...flags], root);
if (auditCode !== 0) process.exit(auditCode);

const testAgentRoot = path.resolve(process.env.FRONTEND_TEST_AGENT_DIR || path.join(root, '..', 'frontend-test-agent'));
if (!await exists(path.join(testAgentRoot, 'src/cli.mjs'))) {
  console.log(`未检测到 frontend-test-agent，已跳过自动测试：${testAgentRoot}`);
  process.exit(0);
}

const localProjects = path.join(root, 'config/projects.local.json');
const projectsFile = await exists(localProjects) ? localProjects : path.join(root, 'config/projects.json');
console.log(`检测到 frontend-test-agent，开始联动测试 ${selector}...`);
const testCode = await run(process.execPath, [path.join(testAgentRoot, 'src/cli.mjs'), 'test', selector, ...flags], testAgentRoot, {
  FRONTEND_TEST_PROJECTS_FILE: projectsFile,
  FRONTEND_TEST_AUTH_DIR: path.join(root, '.auth'),
});
process.exit(testCode);

function run(command, args, cwd, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ...extraEnv } });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}
