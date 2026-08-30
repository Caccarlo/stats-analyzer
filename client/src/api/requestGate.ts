export class RequestCircuitOpenError extends Error {
  status: number;
  blockedUntil: number;

  constructor(status: number, blockedUntil: number) {
    const until = new Date(blockedUntil).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    super(`Richieste SofaScore sospese fino alle ${until} dopo una risposta ${status}.`);
    this.name = 'RequestCircuitOpenError';
    this.status = status;
    this.blockedUntil = blockedUntil;
  }
}

interface RequestGateOptions {
  maximumConcurrent?: number;
  minimumIntervalMs?: number;
  cooldownMs?: number;
  now?: () => number;
  sleep?: (delay: number) => Promise<void>;
}

interface PendingRequest<T> {
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export function createRequestGate({
  maximumConcurrent = 3,
  minimumIntervalMs = 750,
  cooldownMs = 15 * 60 * 1000,
  now = () => Date.now(),
  sleep = (delay) => new Promise((resolve) => window.setTimeout(resolve, delay)),
}: RequestGateOptions = {}) {
  let active = 0;
  let nextStartAt = 0;
  let blockedUntil = 0;
  let blockedStatus: number | null = null;
  const queue: PendingRequest<unknown>[] = [];

  const getCircuitError = (): RequestCircuitOpenError | null => {
    if (blockedStatus === null) return null;
    if (now() >= blockedUntil) {
      blockedStatus = null;
      blockedUntil = 0;
      return null;
    }
    return new RequestCircuitOpenError(blockedStatus, blockedUntil);
  };

  const runNext = () => {
    while (active < maximumConcurrent && queue.length > 0) {
      const entry = queue.shift();
      if (!entry) return;
      active += 1;
      Promise.resolve()
        .then(async () => {
          const existingCircuit = getCircuitError();
          if (existingCircuit) throw existingCircuit;
          const currentTime = now();
          const scheduledAt = Math.max(currentTime, nextStartAt);
          nextStartAt = scheduledAt + Math.max(0, minimumIntervalMs);
          if (scheduledAt > currentTime) await sleep(scheduledAt - currentTime);
          const queuedCircuit = getCircuitError();
          if (queuedCircuit) throw queuedCircuit;
          return entry.task();
        })
        .then(entry.resolve, entry.reject)
        .finally(() => {
          active -= 1;
          runNext();
        });
    }
  };

  const schedule = <T>(task: () => Promise<T>): Promise<T> => {
    const circuitError = getCircuitError();
    if (circuitError) return Promise.reject(circuitError);
    return new Promise<T>((resolve, reject) => {
      queue.push({
        task,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      runNext();
    });
  };

  const openCircuit = (status: number): RequestCircuitOpenError => {
    blockedStatus = status;
    blockedUntil = now() + Math.max(0, cooldownMs);
    const error = new RequestCircuitOpenError(status, blockedUntil);
    const pending = queue.splice(0);
    pending.forEach((entry) => entry.reject(error));
    return error;
  };

  const status = () => {
    const error = getCircuitError();
    return {
      open: Boolean(error),
      status: error?.status ?? null,
      blockedUntil: error?.blockedUntil ?? null,
      active,
      pending: queue.length,
    };
  };

  return { schedule, openCircuit, getCircuitError, status };
}
