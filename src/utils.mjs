import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const SOURCE_EXTENSIONS = new Set(['.vue', '.ts', '.tsx', '.js', '.jsx']);
const execFileAsync = promisify(execFile);

export async function sourceFiles(root) {
  const result = [];
  await walk(path.join(root, 'src'), result);
  return result;
}

export async function changedSourceFiles(root) {
  const names = new Set();
  try {
    const { stdout } = await execFileAsync('git', ['diff', '--name-only', '-z', '--diff-filter=ACMR', 'HEAD', '--'], {
      cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
    });
    splitNull(stdout).forEach((name) => names.add(name));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('找不到Git命令，无法执行变更扫描。');
    try {
      const { stdout } = await execFileAsync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
      splitNull(stdout).forEach((name) => names.add(name));
    } catch {
      throw new Error(`业务项目不是Git仓库或无法读取Git状态：${root}`);
    }
  }
  const { stdout: untracked = '' } = await execFileAsync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
    cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
  });
  splitNull(untracked).forEach((name) => names.add(name));

  const files = [];
  for (const name of names) {
    const normalized = name.replaceAll('\\', '/');
    if (!normalized.startsWith('src/') || !SOURCE_EXTENSIONS.has(path.extname(normalized))) continue;
    const file = path.resolve(root, normalized);
    try { await fs.access(file); files.push(file); } catch { /* Deleted files do not need source scanning. */ }
  }
  return files;
}

function splitNull(value) {
  return String(value || '').split('\0').filter(Boolean);
}

async function walk(directory, result) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(absolute, result);
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) result.push(absolute);
  }
}

export function lineOf(content, index) {
  return content.slice(0, index).split('\n').length;
}

export function relative(root, file) {
  return path.relative(root, file);
}

export function nowSlug() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
