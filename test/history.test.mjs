import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { historySummary, reconcileFindings, updateDecision } from '../src/history.mjs';

test('已确认问题被隐藏，消失后解决，再出现时标记回归', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'frontend-audit-history-'));
  const stateFile = path.join(dir, 'findings.json');
  const finding = {
    project: 'admin', file: 'src/demo.vue', line: 10, contextHash: 'same-code',
    ruleId: 'DEMO_RULE', severity: 'P2', title: '演示问题', message: '演示', evidence: 'demo',
  };
  const options = {
    stateFile, projects: ['admin'], scopes: ['static'], scopeForFinding: () => 'static',
  };

  const first = await reconcileFindings([finding], options);
  assert.equal(first.active.length, 1);
  await updateDecision(stateFile, first.active[0].findingId, 'accepted', '已确认');
  const second = await reconcileFindings([finding], options);
  assert.equal(second.active.length, 0);
  assert.equal(second.suppressed.length, 1);

  await updateDecision(stateFile, first.active[0].findingId, 'open', '准备修复');
  const fixed = await reconcileFindings([], options);
  assert.equal(fixed.newlyResolved, 1);
  const regression = await reconcileFindings([finding], options);
  assert.equal(regression.active[0].regression, true);

  const summary = await historySummary(stateFile, 'admin');
  assert.equal(summary.counts.open, 1);
  await fs.rm(dir, { recursive: true });
});
