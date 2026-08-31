import { expect, test } from 'vitest';
import { PersistentJsonCache } from './persistentCache';

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

test('riusa un valore persistente finché non scade', () => {
  const storage = createStorage();
  let now = 1_000;
  const first = new PersistentJsonCache('test', () => storage, () => now);
  first.set('categories', [{ id: 31 }], 5_000);

  const afterReload = new PersistentJsonCache('test', () => storage, () => now);
  expect(afterReload.get('categories')).toEqual([{ id: 31 }]);

  now = 6_001;
  expect(afterReload.get('categories')).toBeNull();
});

test('ignora storage corrotto senza interrompere il caricamento', () => {
  const storage = createStorage();
  storage.setItem('test:broken', '{');
  const cache = new PersistentJsonCache('test', () => storage);

  expect(cache.get('broken')).toBeNull();
  expect(storage.getItem('test:broken')).toBeNull();
});
