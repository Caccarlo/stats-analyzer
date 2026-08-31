const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DAY_MS = 24 * 60 * 60 * 1000;

function getAssetCachePolicy(imagePath, statusCode = 200) {
  if (statusCode === 404) {
    return { ttlMs: DAY_MS, browserMaxAgeSeconds: 24 * 60 * 60 };
  }

  if (imagePath.startsWith('category/')) {
    return { ttlMs: 365 * DAY_MS, browserMaxAgeSeconds: 30 * 24 * 60 * 60 };
  }
  if (imagePath.startsWith('unique-tournament/')) {
    return { ttlMs: 90 * DAY_MS, browserMaxAgeSeconds: 30 * 24 * 60 * 60 };
  }
  if (imagePath.startsWith('team/')) {
    return { ttlMs: 30 * DAY_MS, browserMaxAgeSeconds: 7 * 24 * 60 * 60 };
  }
  if (imagePath.startsWith('player/')) {
    return { ttlMs: 7 * DAY_MS, browserMaxAgeSeconds: 24 * 60 * 60 };
  }

  return { ttlMs: 7 * DAY_MS, browserMaxAgeSeconds: 24 * 60 * 60 };
}

function createPersistentAssetCache({ directory, now = () => Date.now() }) {
  function pathsFor(imagePath) {
    const key = crypto.createHash('sha256').update(imagePath).digest('hex');
    return {
      bodyPath: path.join(directory, `${key}.bin`),
      metadataPath: path.join(directory, `${key}.json`),
    };
  }

  async function get(imagePath) {
    const { bodyPath, metadataPath } = pathsFor(imagePath);
    try {
      const metadata = JSON.parse(await fs.promises.readFile(metadataPath, 'utf8'));
      if (metadata.imagePath !== imagePath || metadata.expiresAt <= now()) {
        return null;
      }

      const buffer = await fs.promises.readFile(bodyPath);
      return {
        buffer,
        contentType: metadata.contentType,
        statusCode: metadata.statusCode,
        storedAt: metadata.storedAt,
      };
    } catch {
      return null;
    }
  }

  async function set(imagePath, value, ttlMs) {
    const { bodyPath, metadataPath } = pathsFor(imagePath);
    const storedAt = now();
    await fs.promises.mkdir(directory, { recursive: true });

    const suffix = `${process.pid}-${Math.random().toString(36).slice(2)}`;
    const temporaryBodyPath = `${bodyPath}.${suffix}.tmp`;
    const temporaryMetadataPath = `${metadataPath}.${suffix}.tmp`;
    const metadata = {
      version: 1,
      imagePath,
      contentType: value.contentType,
      statusCode: value.statusCode,
      storedAt,
      expiresAt: storedAt + ttlMs,
    };

    await Promise.all([
      fs.promises.writeFile(temporaryBodyPath, value.buffer),
      fs.promises.writeFile(temporaryMetadataPath, JSON.stringify(metadata)),
    ]);
    await Promise.all([
      fs.promises.rename(temporaryBodyPath, bodyPath),
      fs.promises.rename(temporaryMetadataPath, metadataPath),
    ]);
  }

  return { get, set };
}

module.exports = {
  createPersistentAssetCache,
  getAssetCachePolicy,
};
