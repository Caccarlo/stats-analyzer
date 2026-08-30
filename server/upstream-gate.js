class UpstreamCircuitOpenError extends Error {
  constructor(status, blockedUntil) {
    super(`SofaScore upstream sospeso dopo una risposta ${status}.`);
    this.name = 'UpstreamCircuitOpenError';
    this.code = 'sofascore_circuit_open';
    this.statusCode = 503;
    this.upstreamStatus = status;
    this.blockedUntil = blockedUntil;
  }
}

function createUpstreamGate({
  maximumConcurrent = 3,
  minimumIntervalMs = 750,
  cooldownMs = 15 * 60 * 1000,
  now = () => Date.now(),
  sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
} = {}) {
  let active = 0;
  let nextStartAt = 0;
  let blockedUntil = 0;
  let blockedStatus = null;
  const queue = [];

  const currentCircuitError = () => {
    if (!blockedStatus) return null;
    if (now() >= blockedUntil) {
      blockedUntil = 0;
      blockedStatus = null;
      return null;
    }
    return new UpstreamCircuitOpenError(blockedStatus, blockedUntil);
  };

  const clearQueue = (error) => {
    const pending = queue.splice(0);
    pending.forEach((entry) => entry.reject(error));
  };

  const openCircuit = (status) => {
    blockedStatus = status;
    blockedUntil = now() + Math.max(0, cooldownMs);
    const error = new UpstreamCircuitOpenError(status, blockedUntil);
    clearQueue(error);
    return error;
  };

  const inspectStatus = (value) => {
    const status = Number(value?.statusCode);
    if (status === 403 || status === 429) openCircuit(status);
    return value;
  };

  const runNext = () => {
    while (active < maximumConcurrent && queue.length > 0) {
      const entry = queue.shift();
      active += 1;
      Promise.resolve()
        .then(async () => {
          const existingCircuit = currentCircuitError();
          if (existingCircuit) throw existingCircuit;
          const currentTime = now();
          const scheduledAt = Math.max(currentTime, nextStartAt);
          nextStartAt = scheduledAt + Math.max(0, minimumIntervalMs);
          if (scheduledAt > currentTime) await sleep(scheduledAt - currentTime);
          const queuedCircuit = currentCircuitError();
          if (queuedCircuit) throw queuedCircuit;
          try {
            return inspectStatus(await entry.task());
          } catch (error) {
            const status = Number(error?.upstreamStatus || error?.status);
            if (status === 403 || status === 429) throw openCircuit(status);
            throw error;
          }
        })
        .then(entry.resolve, entry.reject)
        .finally(() => {
          active -= 1;
          runNext();
        });
    }
  };

  const schedule = (task) => {
    const circuitError = currentCircuitError();
    if (circuitError) return Promise.reject(circuitError);
    return new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject });
      runNext();
    });
  };

  const status = () => {
    const circuitError = currentCircuitError();
    return {
      open: Boolean(circuitError),
      upstreamStatus: circuitError?.upstreamStatus ?? null,
      blockedUntil: circuitError?.blockedUntil ?? null,
      active,
      pending: queue.length,
      maximumConcurrent,
      minimumIntervalMs,
    };
  };

  return { schedule, status, openCircuit };
}

module.exports = { UpstreamCircuitOpenError, createUpstreamGate };
