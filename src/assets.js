/* ============================================================================
 * assets.js — Optional authored asset preload and lookup.
 *
 * The graphics upgrade can add GLB/textures incrementally without making them
 * required. Empty manifest URLs are skipped, failed optional loads are recorded,
 * and the procedural scene remains the runtime fallback.
 * ==========================================================================*/
'use strict';

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

export function makeGltfLoader() {
  var loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}
import { ASSET_MANIFEST } from '../assets/manifest.js';

function list(kind) {
  return (ASSET_MANIFEST && ASSET_MANIFEST[kind]) || [];
}

function hasUrl(item) {
  return !!(item && item.url && String(item.url).trim());
}

/* Expands a list of manifest model keys to also include each key's
 * fallbackKey chain, so a load failure can always fall back to a record that
 * was actually fetched. Used to scope both preloadAssetPack's real-match
 * fetch and preloadPlayerModels' preview fetch to only what's needed. */
function expandFallbackKeys(keys) {
  var byKey = {};
  list('models').forEach(function (m) { byKey[m.key] = m; });
  var out = {};
  (keys || []).forEach(function (k) {
    var seen = {};
    while (k && !seen[k]) { out[k] = true; seen[k] = true; k = byKey[k] && byKey[k].fallbackKey; }
  });
  return Object.keys(out);
}

function shouldPreload(item, opts) {
  if (!item) return false;
  if (item.venue && opts && opts.venue && item.venue !== opts.venue) return false;
  if (item.palette && opts && opts.courtPalette && item.palette !== opts.courtPalette) return false;
  if (item.timeOfDay && opts && opts.timeOfDay && item.timeOfDay !== opts.timeOfDay) return false;
  if (item.scope === 'player' && opts && opts.neededPlayerKeys &&
      opts.neededPlayerKeys.indexOf(item.key) === -1) return false;
  return true;
}

function makePack() {
  return {
    version: ASSET_MANIFEST.version || 1,
    fallback: true,
    definitions: {
      models: {},
      textures: {},
      environments: {},
      animations: {}
    },
    models: {},
    textures: {},
    environments: {},
    animations: {},
    skipped: [],
    errors: [],
    loaded: [],
    getModel: function (key) { return lookupRecord(this, 'models', key); },
    getTexture: function (key) { return lookupRecord(this, 'textures', key); },
    getEnvironment: function (key) { return lookupRecord(this, 'environments', key); },
    getAnimation: function (key) { return lookupRecord(this, 'animations', key); }
  };
}

function lookupRecord(pack, kind, key, seen) {
  if (!key) return null;
  seen = seen || {};
  if (seen[key]) return null;
  seen[key] = true;
  var record = pack[kind] && pack[kind][key];
  if (record) return record;
  var item = pack.definitions && pack.definitions[kind] && pack.definitions[kind][key];
  if (item && item.fallbackKey) return lookupRecord(pack, kind, item.fallbackKey, seen);
  return null;
}

function addLoaded(pack, kind, item, payload) {
  var bucket = pack[kind];
  bucket[item.key] = {
    key: item.key,
    item: item,
    payload: payload
  };
  pack.loaded.push(item.key);
  pack.fallback = false;
}

function recordSkip(pack, item, reason) {
  pack.skipped.push({
    key: item.key,
    reason: reason
  });
}

function recordError(pack, item, error) {
  pack.errors.push({
    key: item.key,
    url: item.url,
    message: error && error.message ? error.message : String(error)
  });
}

function loadTexture(loader, item) {
  return loader.loadAsync(item.url).then(function (texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  });
}

async function loadManifestItem(pack, loaders, kind, item) {
  if (!shouldPreload(item, pack.options)) return;
  if (!hasUrl(item)) {
    recordSkip(pack, item, 'no-url');
    return;
  }

  try {
    if (kind === 'models' || kind === 'animations') {
      addLoaded(pack, kind, item, await loaders.gltf.loadAsync(item.url));
    } else {
      addLoaded(pack, kind, item, await loadTexture(loaders.texture, item));
    }
  } catch (error) {
    recordError(pack, item, error);
    if (!item.optional) throw error;
  }
}

export async function preloadAssetPack(opts, onProgress) {
  var pack = makePack();
  pack.options = opts || {};
  if (pack.options.neededPlayerKeys) {
    pack.options.neededPlayerKeys = expandFallbackKeys(pack.options.neededPlayerKeys);
  }
  var loaders = {
    gltf: makeGltfLoader(),
    texture: new THREE.TextureLoader()
  };
  var entries = [];
  ['models', 'textures', 'environments', 'animations'].forEach(function (kind) {
    list(kind).forEach(function (item) {
      pack.definitions[kind][item.key] = item;
      entries.push({ kind: kind, item: item });
    });
  });

  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    await loadManifestItem(pack, loaders, entry.kind, entry.item);
    if (onProgress) {
      onProgress({
        loaded: pack.loaded.length,
        skipped: pack.skipped.length,
        errors: pack.errors.length,
        index: i + 1,
        total: entries.length
      });
    }
  }
  delete pack.options;
  return pack;
}

/* Menu-time loader for the character picker preview: loads only the
 * player-scoped model GLBs (no venue textures/environments) and returns a
 * mini pack compatible with makePlayer's opts.assets (getModel + fallback
 * chain + empty animations bucket; clips live inside the player GLBs, or
 * come from the shared clip-library entries in the `animations` bucket).
 * Cached module-level per requested key set so repeated modal opens or
 * repeated matches with the same roster don't re-fetch.
 *
 * `neededKeys` (optional array of manifest model keys) limits the fetch to
 * only the characters actually resolved for the current roster instead of
 * eagerly loading every `scope: 'player'` entry -- important once the
 * roster includes several multi-MB authored characters instead of the two
 * small shared bodies this originally targeted. Omit it to load everything
 * (existing behavior, still used by the picker's "browse all" surface). */
var playerModelPackPromises = new Map();

export function preloadPlayerModels(neededKeys) {
  neededKeys = neededKeys ? expandFallbackKeys(neededKeys) : neededKeys;
  var cacheKey = neededKeys ? neededKeys.slice().sort().join(',') : '*';
  var existing = playerModelPackPromises.get(cacheKey);
  if (existing) return existing;
  var promise = (async function () {
    var pack = makePack();
    pack.options = {};
    var loaders = { gltf: makeGltfLoader(), texture: new THREE.TextureLoader() };
    var items = list('models');
    items.forEach(function (item) { pack.definitions.models[item.key] = item; });
    for (var i = 0; i < items.length; i++) {
      if (items[i].scope !== 'player') continue;
      if (neededKeys && neededKeys.indexOf(items[i].key) === -1) continue;
      await loadManifestItem(pack, loaders, 'models', items[i]);
    }
    delete pack.options;
    return pack;
  })();
  playerModelPackPromises.set(cacheKey, promise);
  promise.catch(function () { playerModelPackPromises.delete(cacheKey); });
  return promise;
}

/* Loads the shared clip libraries (mixamo-swings + mixamo-locomotion, the only
 * `animations`-kind manifest entries with real URLs) once and caches them, so
 * the character preview can play idle + forehand/backhand/overhead without
 * pulling in the full match asset pack. Tiny (~0.07MB swings + locomotion) and
 * shared across every character, so it doesn't meaningfully affect how fast a
 * character model itself appears. Returns a map keyed by animation key →
 * { key, item, payload } records, mergeable into a preview pack's `animations`
 * bucket for collectAnimationClips(). */
var clipLibraryPromise = null;
export function preloadClipLibraries() {
  if (clipLibraryPromise) return clipLibraryPromise;
  clipLibraryPromise = (async function () {
    var out = {};
    var loader = makeGltfLoader();
    var items = list('animations');
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (!hasUrl(item)) continue;
      try {
        out[item.key] = { key: item.key, item: item, payload: await loader.loadAsync(item.url) };
      } catch (e) {
        // Optional: a missing swing/locomotion lib just means no preview animation.
        console.warn('Clip library preload failed:', item.key, e);
      }
    }
    return out;
  })();
  clipLibraryPromise.catch(function () { clipLibraryPromise = null; });
  return clipLibraryPromise;
}

export function cloneModelScene(record) {
  var gltf = record && record.payload;
  var root = gltf && gltf.scene;
  return root ? SkeletonUtils.clone(root) : null;
}

export function assetStatusSummary(pack) {
  if (!pack) return 'no asset pack';
  return pack.loaded.length + ' loaded, ' + pack.skipped.length + ' skipped, ' + pack.errors.length + ' errors';
}
