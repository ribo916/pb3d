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
import { ASSET_MANIFEST } from '../assets/manifest.js';

function list(kind) {
  return (ASSET_MANIFEST && ASSET_MANIFEST[kind]) || [];
}

function hasUrl(item) {
  return !!(item && item.url && String(item.url).trim());
}

function shouldPreload(item, opts) {
  if (!item) return false;
  if (item.venue && opts && opts.venue && item.venue !== opts.venue) return false;
  if (item.palette && opts && opts.courtPalette && item.palette !== opts.courtPalette) return false;
  if (item.timeOfDay && opts && opts.timeOfDay && item.timeOfDay !== opts.timeOfDay) return false;
  return true;
}

function makePack() {
  return {
    version: ASSET_MANIFEST.version || 1,
    fallback: true,
    models: {},
    textures: {},
    environments: {},
    animations: {},
    skipped: [],
    errors: [],
    loaded: [],
    getModel: function (key) { return this.models[key] || null; },
    getTexture: function (key) { return this.textures[key] || null; },
    getEnvironment: function (key) { return this.environments[key] || null; },
    getAnimation: function (key) { return this.animations[key] || null; }
  };
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
  var loaders = {
    gltf: new GLTFLoader(),
    texture: new THREE.TextureLoader()
  };
  var entries = [];
  ['models', 'textures', 'environments', 'animations'].forEach(function (kind) {
    list(kind).forEach(function (item) {
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

export function cloneModelScene(record) {
  var gltf = record && record.payload;
  var root = gltf && gltf.scene;
  return root ? root.clone(true) : null;
}

export function assetStatusSummary(pack) {
  if (!pack) return 'no asset pack';
  return pack.loaded.length + ' loaded, ' + pack.skipped.length + ' skipped, ' + pack.errors.length + ' errors';
}
