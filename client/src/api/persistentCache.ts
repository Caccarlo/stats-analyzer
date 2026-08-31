interface StoredValue<T> {
  version: 1;
  expiresAt: number;
  value: T;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export class PersistentJsonCache {
  private readonly namespace: string;
  private readonly storageProvider: () => StorageLike | null;
  private readonly now: () => number;

  constructor(
    namespace: string,
    storageProvider: () => StorageLike | null = defaultStorage,
    now: () => number = () => Date.now(),
  ) {
    this.namespace = namespace;
    this.storageProvider = storageProvider;
    this.now = now;
  }

  private storageKey(key: string): string {
    return `${this.namespace}:${key}`;
  }

  get<T>(key: string): T | null {
    const storage = this.storageProvider();
    if (!storage) return null;

    const storageKey = this.storageKey(key);
    try {
      const raw = storage.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as StoredValue<T>;
      if (parsed.version !== 1 || parsed.expiresAt <= this.now()) {
        storage.removeItem(storageKey);
        return null;
      }
      return parsed.value;
    } catch {
      try {
        storage.removeItem(storageKey);
      } catch {
        // Storage can be unavailable in privacy mode; the in-memory cache still works.
      }
      return null;
    }
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    const storage = this.storageProvider();
    if (!storage) return;

    try {
      const payload: StoredValue<T> = {
        version: 1,
        expiresAt: this.now() + ttlMs,
        value,
      };
      storage.setItem(this.storageKey(key), JSON.stringify(payload));
    } catch {
      // Quota/security failures must never prevent the live SofaScore request.
    }
  }
}

export const sofaScorePersistentCache = new PersistentJsonCache('stats-analyzer:sofascore:v1');
