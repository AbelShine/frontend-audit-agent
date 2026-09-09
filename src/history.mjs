import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const SUPPRESSED = new Set(['accepted', 'false_positive', 'ignored']);
const DECISION_STATUSES = new Set(['open', 'accepted', 'false_positive', 'ignored']);

export async function reconcileFindings(findings, options) {
  const state = await loadState(options.stateFile);
  const now = new Date().toISOString();
  const current = new Set();
  const active = [];
  const suppressed = [];

  for (const finding of findings) {
    const scope = options.scopeForFinding(finding);
    const fingerprint = createFingerprint(finding, scope);
    const findingId = `F-${fingerprint.slice(0, 10).toUpperCase()}`;
    current.add(fingerprint);
    const previous = state.records[fingerprint];
    const regression = previous?.status === 'resolved';
    const record = previous || {
      findingId,
      fingerprint,
      firstSeen: now,
      status: 'open',
    };
    if (regression) record.status = 'open';
    Object.assign(record, {
      findingId,
      project: finding.project,
      scope,
      ruleId: finding.ruleId,
      severity: finding.severity,
      file: finding.file,
      title: finding.title,
      lastSeen: now,
      resolvedAt: undefined,
    });
    state.records[fingerprint] = record;
    const enriched = { ...finding, findingId, status: record.status, regression };
    if (SUPPRESSED.has(record.status)) suppressed.push(enriched);
    else active.push(enriched);
  }

  let newlyResolved = 0;
  if (options.resolveMissing !== false) {
    for (const [fingerprint, record] of Object.entries(state.records)) {
      if (!options.projects.includes(record.project) || !options.scopes.includes(record.scope) || current.has(fingerprint)) continue;
      if (record.status === 'open') {
        record.status = 'resolved';
        record.resolvedAt = now;
        newlyResolved += 1;
      }
    }
  }

  state.updatedAt = now;
  await saveState(options.stateFile, state);
  return { active, suppressed, newlyResolved, totalRecords: Object.keys(state.records).length };
}

export async function updateDecision(stateFile, findingId, status, reason = '') {
  if (!DECISION_STATUSES.has(status)) throw new Error(`状态必须是：${[...DECISION_STATUSES].join('、')}`);
  const state = await loadState(stateFile);
  const record = Object.values(state.records).find((item) => item.findingId === findingId);
  if (!record) throw new Error(`找不到问题ID：${findingId}`);
  record.status = status;
  record.reason = reason;
  record.decisionAt = new Date().toISOString();
  await saveState(stateFile, state);
  return record;
}

export async function historySummary(stateFile, project = 'all') {
  const state = await loadState(stateFile);
  const records = Object.values(state.records).filter((item) => project === 'all' || item.project === project);
  const counts = records.reduce((result, item) => {
    result[item.status] = (result[item.status] || 0) + 1;
    return result;
  }, {});
  return { counts, records: records.sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen))) };
}

function createFingerprint(finding, scope) {
  const runtimeEvidence = normalizeRuntimeEvidence(finding.evidence || finding.message || '');
  const evidenceKey = finding.contextHash || runtimeEvidence;
  return crypto.createHash('sha256').update([
    finding.project,
    scope,
    finding.ruleId,
    finding.file || normalizeRuntimeEvidence(finding.url || ''),
    evidenceKey,
  ].join('|')).digest('hex');
}

function normalizeRuntimeEvidence(value) {
  return String(value)
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '<uuid>')
    .replace(/\b\d{10,}\b/g, '<number>')
    .replace(/\s+/g, ' ')
    .trim();
}

async function loadState(file) {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    return { version: 1, records: {}, ...parsed };
  } catch {
    return { version: 1, records: {} };
  }
}

async function saveState(file, state) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}
