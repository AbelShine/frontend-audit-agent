import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { auditRuntime } from '../src/runtime/browser-audit.mjs';

test('运行态巡检停在登录页时给出保存登录状态提示', async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<main><h1>系统登录</h1><input type="password" placeholder="密码"></main>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'frontend-audit-login-'));
  try {
    const result = await auditRuntime('admin', {
      type: 'jeecg-admin', url: `http://127.0.0.1:${server.address().port}/login`, routes: ['/login'],
      viewports: [{ name: 'desktop', width: 800, height: 600 }],
    }, outputDir);
    const finding = result.findings.find((item) => item.ruleId === 'AUTH_REQUIRED');
    assert.ok(finding);
    assert.match(finding.suggestion, /pnpm run auth -- admin/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(outputDir, { recursive: true });
  }
});
