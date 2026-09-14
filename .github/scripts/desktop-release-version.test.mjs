import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chooseVersion } from './desktop-release-version.mjs';

test('the first release uses the package version', () => {
  assert.equal(chooseVersion('0.1.0', []), '0.1.0');
});

test('merges advance the greatest stable tag numerically', () => {
  assert.equal(chooseVersion('0.1.0', ['v0.1.9', 'v0.1.10', 'v0.1.2']), '0.1.11');
  assert.equal(chooseVersion('0.1.0', ['v1.9.8', 'v2.0.0']), '2.0.1');
});

test('an explicit package version can start a larger release', () => {
  assert.equal(chooseVersion('0.2.0', ['v0.1.12']), '0.2.0');
  assert.equal(chooseVersion('1.0.0', ['v0.9.12']), '1.0.0');
});

test('unrelated and prerelease tags leave the stable sequence intact', () => {
  assert.equal(chooseVersion('0.1.0', ['cli-5.0', 'v9.0.0-beta.1', 'v01.2.3', 'v0.1.0']), '0.1.1');
});

test('retrying a tagged commit reuses its version even after another release', () => {
  assert.equal(chooseVersion('0.1.0', ['v0.1.0', 'v0.1.1'], ['v0.1.0']), '0.1.0');
});

test('invalid package versions fail before packaging', () => {
  for (const version of ['v0.1.0', '0.1', '0.1.0-beta.1', '01.0.0']) {
    assert.throws(() => chooseVersion(version, []), /stable MAJOR.MINOR.PATCH/);
  }
});
