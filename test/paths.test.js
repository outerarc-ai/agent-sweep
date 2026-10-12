import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { expandPath, expandPaths, collapseHome, displayPath, isPathInside, toPosix, uniquePaths } from '../src/lib/paths.js';
import { homedir } from '../src/lib/platform.js';

test('expandPath expands ~ and named tokens', () => {
  const home = homedir();
  assert.equal(expandPath('~'), home);
  assert.equal(expandPath('~/.claude'), path.join(home, '.claude'));
  assert.equal(expandPath('{home}/x'), path.join(home, 'x'));
  const config = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  assert.equal(expandPath('{config}/goose/config.yaml'), path.join(config, 'goose', 'config.yaml'));
});

test('expandPath normalizes and passes absolute paths through', () => {
  assert.equal(expandPath('/a/b/../c'), path.normalize('/a/c'));
  assert.equal(expandPath(''), '');
  assert.equal(expandPath(null), null);
});

test('expandPaths maps a list', () => {
  const home = homedir();
  assert.deepEqual(expandPaths(['~/a', '~/b']), [path.join(home, 'a'), path.join(home, 'b')]);
});

test('collapseHome collapses only the home prefix', () => {
  const home = homedir();
  assert.equal(collapseHome(home, home), '~');
  assert.equal(collapseHome(path.join(home, '.claude', 'x'), home), '~/.claude/x');
  assert.equal(collapseHome('/other/x', home), '/other/x');
  assert.equal(displayPath(path.join(home, 'a'), home), '~/a');
});

test('isPathInside is reflexive and separator aware', () => {
  assert.equal(isPathInside('/a', '/a'), true);
  assert.equal(isPathInside('/a', '/a/b/c'), true);
  assert.equal(isPathInside('/a', '/ab'), false);
  assert.equal(isPathInside('/a', '/b'), false);
  assert.equal(isPathInside(null, '/a'), false);
});

test('toPosix converts separators', () => {
  assert.equal(toPosix(path.join('a', 'b', 'c')), 'a/b/c');
});

test('uniquePaths dedupes normalized paths', () => {
  assert.deepEqual(uniquePaths(['/a/b', '/a/./b', '/a//b', '', null]), ['/a/b']);
});