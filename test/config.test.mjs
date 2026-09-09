import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjects, projectRoot } from '../src/config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('项目配置中的相对路径会基于工具目录解析', async () => {
  const previous = process.env.FRONTEND_AUDIT_PROJECTS_FILE;
  process.env.FRONTEND_AUDIT_PROJECTS_FILE = path.join(root, 'config/projects.json');
  const projects = await loadProjects();
  if (previous === undefined) delete process.env.FRONTEND_AUDIT_PROJECTS_FILE;
  else process.env.FRONTEND_AUDIT_PROJECTS_FILE = previous;
  assert.equal(projectRoot(), root);
  assert.equal(projects.demo.root, path.resolve(root, 'demo-project'));
  assert.equal(projects.admin.root, path.resolve(root, '../admin-project'));
  assert.equal(projects.mobile.root, path.resolve(root, '../mobile-project'));
  assert.equal(projects.screen.root, path.resolve(root, '../screen-project'));
});

test('公共项目配置不包含用户主目录绝对路径', async () => {
  const content = await fs.readFile(path.join(root, 'config/projects.json'), 'utf8');
  assert.doesNotMatch(content, /\/Users\/|\/home\/|[A-Za-z]:\\\\/);
});

test('Windows工作区脚本使用项目配置且不包含个人绝对路径', async () => {
  const content = await fs.readFile(path.join(root, 'start-workspace.ps1'), 'utf8');
  assert.match(content, /projects\.local\.json/);
  assert.match(content, /startCommand/);
  assert.match(content, /Test-ServiceReady/);
  assert.match(content, /src\/run-with-tests\.mjs/);
  assert.match(content, /playwright install chromium/);
  assert.doesNotMatch(content, /\/Users\/|[A-Za-z]:\\\\(?:Users|CH-project)/);
});
