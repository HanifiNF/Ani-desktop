import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const compare = (a, b) => {
  const left = a.split('.').map(BigInt);
  const right = b.split('.').map(BigInt);
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
};
const versions = (tags) => tags
  .filter((tag) => tag.startsWith('v') && stableVersion.test(tag.slice(1)))
  .map((tag) => tag.slice(1))
  .sort(compare);

export function chooseVersion(base, tags, commitTags = []) {
  if (!stableVersion.test(base)) throw new Error('Package version must be a stable MAJOR.MINOR.PATCH version');

  // A full rerun resumes a draft or recognizes a previously published commit.
  const existing = versions(commitTags).at(-1);
  if (existing) return existing;

  const latest = versions(tags).at(-1);
  if (!latest || compare(base, latest) > 0) return base;
  const [major, minor, patch] = latest.split('.');
  return `${major}.${minor}.${BigInt(patch) + 1n}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const gitTags = (...args) => execFileSync('git', ['tag', ...args], { encoding: 'utf8' }).trim().split('\n');
  const pkg = JSON.parse(readFileSync('desktop-app/package.json', 'utf8'));
  const version = chooseVersion(pkg.version, gitTags('--list'), gitTags('--points-at', 'HEAD'));
  const output = `version=${version}\ntag=v${version}\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
  process.stdout.write(output);
}
