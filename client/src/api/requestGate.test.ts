import { expect, test, vi } from 'vitest';
import { createRequestGate } from './requestGate';

test('un 403 rifiuta la coda client ma consente un nuovo tentativo immediato', async () => {
  const clock = 1_000;
  let releaseFirst: (() => void) | undefined;
  const gate = createRequestGate({
    maximumConcurrent: 1,
    minimumIntervalMs: 0,
    cooldownMs: 60_000,
    now: () => clock,
  });
  const first = gate.schedule(() => new Promise<void>((resolve) => { releaseFirst = resolve; }));
  const queuedTask = vi.fn(async () => undefined);
  const queued = gate.schedule(queuedTask);
  await vi.waitFor(() => expect(releaseFirst).toBeTypeOf('function'));

  const circuitError = gate.openCircuit(403);
  releaseFirst?.();
  await first;
  await expect(queued).rejects.toBe(circuitError);
  expect(queuedTask).not.toHaveBeenCalled();
  expect(gate.status()).toMatchObject({ open: false, status: null, pending: 0 });

  await expect(gate.schedule(async () => 'ok')).resolves.toBe('ok');
});

test('un 429 mantiene il cooldown client configurato', async () => {
  let clock = 1_000;
  const gate = createRequestGate({
    maximumConcurrent: 1,
    minimumIntervalMs: 0,
    cooldownMs: 60_000,
    now: () => clock,
  });

  gate.openCircuit(429);
  expect(gate.status()).toMatchObject({ open: true, status: 429 });
  await expect(gate.schedule(async () => 'too-soon')).rejects.toMatchObject({ status: 429 });
  clock = 61_000;
  await expect(gate.schedule(async () => 'ok')).resolves.toBe('ok');
});
