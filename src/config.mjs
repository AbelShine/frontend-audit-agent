import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function loadProjects() {
  const localFile = path.join(ROOT, 'config/projects.local.json');
  const sharedFile = path.join(ROOT, 'config/projects.json');
  const configFile = process.env.FRONTEND_AUDIT_PROJECTS_FILE
    ? path.resolve(process.env.FRONTEND_AUDIT_PROJECTS_FILE)
    : await fs.access(localFile).then(() => localFile).catch(() => sharedFile);
  const raw = await fs.readFile(configFile, 'utf8');
  const projects = JSON.parse(raw);
  for (const project of Object.values(projects)) {
    if (project.root && !path.isAbsolute(project.root)) {
      project.root = path.resolve(ROOT, project.root);
    }
  }
  return projects;
}

export function projectRoot() {
  return ROOT;
}

export function selectProjects(projects, selector) {
  if (!selector || selector === 'all') return Object.entries(projects);
  if (!projects[selector]) {
    throw new Error(`未知项目 ${selector}，可选：${Object.keys(projects).join(', ')}`);
  }
  return [[selector, projects[selector]]];
}
