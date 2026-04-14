import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function loadPublicModule() {
  const envPath = process.env.INTENT_PUBLIC_MODULE;
  const candidates = [
    envPath,
    '../src/public-api.js',
    '../src/index.js',
    '../src/index.mjs',
    '../index.js'
  ].filter(Boolean);

  for (const candidate of candidates) {
    const absolutePath = path.resolve(__dirname, candidate);
    if (await fileExists(absolutePath)) {
      return import(pathToFileURL(absolutePath).href);
    }
  }

  assert.fail(
    `No public module found. Set INTENT_PUBLIC_MODULE or provide one of: ${candidates.join(', ')}`
  );
}

function pickExport(module, names) {
  for (const name of names) {
    if (typeof module[name] === 'function') {
      return module[name];
    }
  }
  return null;
}

function pickMethod(object, names) {
  for (const name of names) {
    if (typeof object?.[name] === 'function') {
      return object[name].bind(object);
    }
  }
  return null;
}

function createSpy(asyncImpl = null) {
  const calls = [];
  const fn = async (...args) => {
    calls.push(args);
    if (asyncImpl) {
      return asyncImpl(...args);
    }
  };
  fn.calls = calls;
  return fn;
}

async function createHarness() {
  const mod = await loadPublicModule();

  const createController = pickExport(mod, [
    'createIntentOperationController',
    'createOperationController',
    'createInteractionController',
    'createModelController'
  ]);

  assert.ok(createController, 'Public module must export a controller factory function');

  const appendCanonicalOperation = createSpy();
  const runExactModel = createSpy(async () => {
    await Promise.resolve();
    return { exact: true };
  });
  const runFullModel = createSpy(async () => ({ full: true }));
  const updatePreviewMesh = createSpy();

  const controller = createController({
    operationType: 'pushPull',
    appendCanonicalOperation,
    runExactModel,
    runFullModel,
    updatePreviewMesh
  });

  const preview = pickMethod(controller, ['preview', 'updatePreview', 'update']);
  const commit = pickMethod(controller, ['commit', 'finalize', 'complete']);

  assert.ok(preview, 'Controller must expose a preview/update method');
  assert.ok(commit, 'Controller must expose a commit/finalize method');

  return {
    preview,
    commit,
    appendCanonicalOperation,
    runExactModel,
    runFullModel,
    updatePreviewMesh
  };
}

test('preview updates do not execute kernel/full model', async () => {
  const h = await createHarness();
  const params = { targetId: 'face-1', distance: 8, axis: 'normal' };

  await h.preview(params);

  assert.equal(h.runExactModel.calls.length, 0, 'Preview must not run exact kernel model');
  assert.equal(h.runFullModel.calls.length, 0, 'Preview must not run full model execution');
  assert.ok(h.updatePreviewMesh.calls.length >= 1, 'Preview should update preview mesh');
});

test('commit appends canonical TypeScript operation code', async () => {
  const h = await createHarness();
  const params = { targetId: 'face-1', distance: 5, axis: 'normal' };

  await h.preview(params);
  await h.commit(params);

  assert.equal(h.appendCanonicalOperation.calls.length, 1, 'Commit must append canonical operation code');
  const [code] = h.appendCanonicalOperation.calls[0];
  assert.equal(typeof code, 'string', 'Canonical operation must be serialized as code string');
  assert.ok(code.trim().length > 0, 'Canonical operation code must be non-empty');
  assert.match(code, /[A-Za-z_$][\w$]*\s*\(/, 'Canonical operation should look like executable code');
});

test('commit path executes exact model asynchronously', async () => {
  const h = await createHarness();
  const params = { targetId: 'edge-2', distance: 3, axis: 'x' };

  await h.preview(params);
  const pending = h.commit(params);

  assert.equal(typeof pending?.then, 'function', 'Commit must return a Promise for async exact recompute');

  await pending;
  assert.equal(h.runExactModel.calls.length, 1, 'Commit must execute exact model path once');
});

test('preview and commit share same operation params', async () => {
  const h = await createHarness();
  const params = { targetId: 'face-9', distance: 12.5, axis: 'normal' };

  await h.preview(params);
  await h.commit(params);

  assert.ok(h.updatePreviewMesh.calls.length >= 1, 'Preview call expected');
  assert.equal(h.runExactModel.calls.length, 1, 'Commit exact execution expected');

  const previewArgs = h.updatePreviewMesh.calls.at(-1);
  const exactArgs = h.runExactModel.calls[0];
  const previewParams = previewArgs?.[0]?.params ?? previewArgs?.[0] ?? previewArgs?.[1];
  const commitParams = exactArgs?.[0]?.params ?? exactArgs?.[0] ?? exactArgs?.[1];

  assert.deepEqual(
    commitParams,
    previewParams,
    'Preview and commit must use identical semantic operation parameters'
  );
});
