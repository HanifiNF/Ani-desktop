import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const stableTag = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

export function publishingRequested(eventName, ref, mode) {
  const publish = eventName === 'schedule'
    || (eventName === 'workflow_dispatch' && mode === 'Publish release');
  if (publish && ref !== 'refs/heads/master') {
    throw new Error('Publishing requires the master branch. Select Test packages to build another branch.');
  }
  if (!publish && !(eventName === 'workflow_dispatch' && mode === 'Test packages')) {
    throw new Error('Unsupported release event or mode');
  }
  return publish;
}

export function needsRelease(releases, runGit = git) {
  const latest = releases
    .filter((release) => !release.draft && !release.prerelease
      && release.published_at && stableTag.test(release.tag_name))
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))[0];
  if (!latest) return true;

  // Resolve the tag itself: target_commitish can be a moving branch name.
  const releasedCommit = runGit('rev-parse', '--verify', `refs/tags/${latest.tag_name}^{commit}`);
  try {
    // Also skip an older queued run whose changes are already published.
    runGit('merge-base', '--is-ancestor', 'HEAD', releasedCommit);
    return false;
  } catch (error) {
    if (error.status === 1) return true;
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const publish = publishingRequested(process.env.GITHUB_EVENT_NAME, process.env.GITHUB_REF, process.env.RELEASE_MODE);
  let build = true;
  if (publish) {
    // Paginate so drafts, prereleases, and older releases cannot hide the baseline.
    // API failures must fail the run rather than look like a first release.
    const pages = JSON.parse(execFileSync('gh', [
      'api', '--paginate', '--slurp', `repos/${process.env.GH_REPO}/releases?per_page=100`,
    ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
    build = needsRelease(pages.flat());
  }
  const output = `build=${build}\npublish=${publish && build}\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
  process.stdout.write(output);
  const summary = build
    ? (publish ? 'Unreleased changes found. Checks and release packages will run.' : 'Test packages will be saved as workflow artifacts.')
    : 'Skipped: this commit is already included in a published stable release.';
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  console.log(summary);
}
