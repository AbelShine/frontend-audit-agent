import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { changedSourceFiles } from '../src/utils.mjs';

const exec = promisify(execFile);

test('Git变更扫描只返回修改和新增的源码文件', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frontend-audit-git-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/base.ts'), 'export const base = 1;\n');
  await fs.writeFile(path.join(root, 'README.md'), '# demo\n');
  await exec('git', ['init'], { cwd: root });
  await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  await exec('git', ['config', 'user.name', 'Test'], { cwd: root });
  await exec('git', ['add', '.'], { cwd: root });
  await exec('git', ['commit', '-m', 'init'], { cwd: root });
  await fs.writeFile(path.join(root, 'src/base.ts'), 'export const base = 2;\n');
  await fs.writeFile(path.join(root, 'src/new.vue'), '<template />\n');
  await fs.writeFile(path.join(root, 'README.md'), '# changed\n');

  const files = (await changedSourceFiles(root)).map((file) => path.relative(root, file).replaceAll('\\', '/')).sort();
  assert.deepEqual(files, ['src/base.ts', 'src/new.vue']);
  await fs.rm(root, { recursive: true });
});
