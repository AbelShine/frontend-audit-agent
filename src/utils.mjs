import fs from 'node:fs/promises';
import path from 'node:path';

const SOURCE_EXTENSIONS = new Set(['.vue', '.ts', '.tsx', '.js', '.jsx']);

export async function sourceFiles(root) {
  const result = [];
  await walk(path.join(root, 'src'), result);
  return result;
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
