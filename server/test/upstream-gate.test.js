const test = require('node:test');
const assert = require('node:assert/strict');
const { createUpstreamGate } = require('../upstream-gate');

test('il primo 403 svuota la coda globale e apre il cooldown', async () => {
  let clock = 1_000;
  let calls = 0;
  const gate = createUpstreamGate({
    maximumConcurrent: 1,
    minimumIntervalMs: 0,
    cooldownMs: 60_000,
    now: () => clock,
  });
  const tasks = Array.from({ length: 20 }, () => gate.schedule(async () => {
    calls += 1;
    return { statusCode: 403 };
  }));
  const results = await Promise.allSettled(tasks);

  assert.equal(calls, 1);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results.slice(1).every((result) => (
    result.status === 'rejected' && result.reason.code === 'sofascore_circuit_open'
  )), true);
  assert.deepEqual(gate.status(), {
    open: true,
    upstreamStatus: 403,
    blockedUntil: 61_000,
    active: 0,
    pending: 0,
    maximumConcurrent: 1,
    minimumIntervalMs: 0,
  });

  await assert.rejects(
    () => gate.schedule(async () => ({ statusCode: 200 })),
    (error) => error.code === 'sofascore_circuit_open',
  );
  clock = 61_000;
  assert.equal((await gate.schedule(async () => ({ statusCode: 200 }))).statusCode, 200);
});
