const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  createPersistentAssetCache,
  getAssetCachePolicy,
} = require('../persistent-asset-cache');

test('la cache asset sopravvive a una nuova istanza del server', async (t) => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stats-asset-cache-'));
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  let currentTime = 1_000;
  const first = createPersistentAssetCache({ directory, now: () => currentTime });

  await first.set('team/1/image', {
    buffer: Buffer.from('logo'),
    contentType: 'image/png',
    statusCode: 200,
  }, 10_000);

  const second = createPersistentAssetCache({ directory, now: () => currentTime });
  const cached = await second.get('team/1/image');
  assert.equal(cached.contentType, 'image/png');
  assert.equal(cached.statusCode, 200);
  assert.equal(cached.buffer.toString(), 'logo');

  currentTime = 2_000;
  await second.set('team/1/image', {
    buffer: Buffer.from('logo-aggiornato'),
    contentType: 'image/webp',
    statusCode: 200,
  }, 10_000);
  assert.equal((await first.get('team/1/image')).buffer.toString(), 'logo-aggiornato');

  currentTime = 12_001;
  assert.equal(await second.get('team/1/image'), null);
});

test('bandiere e loghi di competizione hanno una durata maggiore delle foto giocatore', () => {
  const flag = getAssetCachePolicy('category/31/image');
  const tournament = getAssetCachePolicy('unique-tournament/23/image');
  const player = getAssetCachePolicy('player/123/image');

  assert.ok(flag.ttlMs > tournament.ttlMs);
  assert.ok(tournament.ttlMs > player.ttlMs);
  assert.equal(getAssetCachePolicy('team/1/image', 404).ttlMs, 24 * 60 * 60 * 1000);
});
