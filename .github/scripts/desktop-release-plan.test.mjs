import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { needsRelease, publishingRequested } from './desktop-release-plan.mjs';

let directory;
let firstCommit;
const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const release = (tag, overrides = {}) => ({
  tag_name: tag, draft: false, prerelease: false, published_at: '2026-09-18T16:30:00Z', ...overrides,
});

before(() => {
  directory = mkdtempSync(join(tmpdir(), 'desktop-release-plan-'));
  git('init');
  git('config', 'user.name', 'Test User');
  git('config', 'user.email', 'test@example.com');
  git('-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'First');
  firstCommit = git('rev-parse', 'HEAD');
  git('tag', 'v0.1.0');
  git('-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'Second');
  git('tag', 'v0.1.1');
  git('-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'Third');
  git('-c', 'tag.gpgsign=false', 'tag', '-a', 'v0.1.2', '-m', 'Annotated release');
});

after(() => rmSync(directory, { recursive: true, force: true }));

test('nightly and explicit manual publication require master', () => {
  assert.equal(publishingRequested('schedule', 'refs/heads/master', ''), true);
  assert.equal(publishingRequested('workflow_dispatch', 'refs/heads/master', 'Publish release'), true);
  for (const ref of ['refs/heads/feature', 'refs/tags/v0.1.2']) {
    assert.throws(() => publishingRequested('schedule', ref, ''), /requires the master branch/);
    assert.throws(() => publishingRequested('workflow_dispatch', ref, 'Publish release'), /requires the master branch/);
  }
  assert.throws(() => publishingRequested('push', 'refs/heads/master', ''), /Unsupported/);
});

test('test packages are available on branches and master without publication', () => {
  for (const ref of ['refs/heads/feature', 'refs/heads/master']) {
    assert.equal(publishingRequested('workflow_dispatch', ref, 'Test packages'), false);
  }
});

test('a first release and commits since the last published release require packages', () => {
  assert.equal(needsRelease([], git), true);
  assert.equal(needsRelease([release('v0.1.0')], git), true);
});

test('the current published commit is skipped, including annotated tags', () => {
  assert.equal(needsRelease([release('v0.1.2', { target_commitish: 'master' })], git), false);
});

test('drafts and bare tags from failed runs remain eligible for retry', () => {
  assert.equal(needsRelease([release('v0.1.1'), release('v0.1.2', { draft: true })], git), true);
  assert.equal(needsRelease([release('v0.1.1')], git), true);
  assert.equal(needsRelease([release('v0.1.2', { draft: true, published_at: null })], git), true);
});

test('prereleases and unrelated tags cannot suppress a stable release', () => {
  assert.equal(needsRelease([
    release('v0.1.1'), release('v0.1.2', { prerelease: true }),
    release('cli-5.0'), release('v0.2.0-beta.1'), release('v01.0.0'),
  ], git), true);
});

test('the baseline is the most recently published stable release regardless of API order', () => {
  assert.equal(needsRelease([
    release('v0.1.1'), release('v0.1.2', { published_at: '2026-09-19T16:30:00Z' }), release('v0.1.0'),
  ], git), false);
});

test('an older queued run is skipped when its changes were already released', () => {
  const olderCheckout = (...args) => git(...args.map((arg) => arg === 'HEAD' ? firstCommit : arg));
  assert.equal(needsRelease([release('v0.1.2')], olderCheckout), false);
});

test('missing tags and git failures stop planning instead of triggering a release', () => {
  assert.throws(() => needsRelease([release('v9.0.0')], git));
  assert.throws(() => needsRelease([release('v0.1.2')], (...args) => {
    if (args[0] === 'merge-base') throw Object.assign(new Error('git failed'), { status: 128 });
    return git(...args);
  }), /git failed/);
});

test('manual package planning writes workflow outputs without querying GitHub', () => {
  const output = join(directory, 'outputs');
  execFileSync(process.execPath, [fileURLToPath(new URL('./desktop-release-plan.mjs', import.meta.url))], {
    cwd: directory,
    env: {
      ...process.env, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/feature',
      RELEASE_MODE: 'Test packages', GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: '', GH_TOKEN: '', GH_REPO: '',
    },
  });
  assert.equal(readFileSync(output, 'utf8'), 'build=true\npublish=false\n');
});
