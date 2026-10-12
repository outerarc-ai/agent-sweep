import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globToRegExp, matchGlob, matchAnyGlob, matchAnySegment } from '../src/lib/matcher.js';

test('globToRegExp matches literal paths', () => {
  const re = globToRegExp('/Users/me/.claude.json');
  assert.equal(re.test('/Users/me/.claude.json'), true);
  assert.equal(re.test('/Users/me/.claude.js'), false);
});

test('** matches across path separators', () => {
  assert.equal(matchGlob('/a/b/c/d.json', '/a/**/*.json'), true);
  assert.equal(matchGlob('/a/d.json', '/a/**/*.json'), true);
  assert.equal(matchGlob('/a/b/c/d.txt', '/a/**/*.json'), false);
});

test('* does not cross separators', () => {
  assert.equal(matchGlob('/a/b.json', '/a/*.json'), true);
  assert.equal(matchGlob('/a/b/c.json', '/a/*.json'), false);
});

test('? matches a single non-separator character', () => {
  assert.equal(matchGlob('/a/b1.json', '/a/b?.json'), true);
  assert.equal(matchGlob('/a/b12.json', '/a/b?.json'), false);
});

test('brace expansion', () => {
  assert.equal(matchGlob('/a/x.md', '/a/*.{md,txt}'), true);
  assert.equal(matchGlob('/a/x.txt', '/a/*.{md,txt}'), true);
  assert.equal(matchGlob('/a/x.json', '/a/*.{md,txt}'), false);
});

test('matchAnyGlob returns the matched pattern', () => {
  const patterns = ['/a/**', '/b/*.json'];
  assert.equal(matchAnyGlob('/b/x.json', patterns), '/b/*.json');
  assert.equal(matchAnyGlob('/c/x.json', patterns), null);
});

test('matchAnySegment finds basename matches', () => {
  assert.equal(matchAnySegment('/x/y/CLAUDE.md', ['CLAUDE.md']), 'CLAUDE.md');
  assert.equal(matchAnySegment('/x/y/z.txt', ['CLAUDE.md']), null);
});

test('regexes are cached and stable', () => {
  const a = globToRegExp('/x/**');
  const b = globToRegExp('/x/**');
  assert.equal(a, b);
});