// Self-test for the guard itself.
//
// The check in token-test.mjs is the only thing standing between a renamed
// token and a silently unstyled element, so it gets the treatment every guard
// deserves: a fixture that must PASS, a fixture that must FAIL, and assertions
// that the check breaks loudly when it is wired up wrong.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import preset from '../dist/tailwind.preset.js';
import { assertClassesResolve, sourceFiles, familiesOf, resolvesInPreset, scanClasses } from './token-test.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESOLVES = join(HERE, 'fixtures', 'resolves');
const UNRESOLVED = join(HERE, 'fixtures', 'unresolved');

test('the preset declares the families the design system names', () => {
  const families = familiesOf(preset);
  for (const family of ['slate', 'frost', 'cobalt', 'green', 'amber', 'red', 'surface', 'border', 'text', 'action', 'ink']) {
    assert.ok(families.has(family), `preset has no colour family "${family}"`);
  }
});

test('resolution handles flat keys, nested scales and groups without a DEFAULT', () => {
  assert.ok(resolvesInPreset(preset, 'slate-900'), 'nested scale step');
  assert.ok(resolvesInPreset(preset, 'surface-muted'), 'flat semantic key');
  assert.ok(resolvesInPreset(preset, 'action'), 'flat key whose value is a string');
  assert.ok(resolvesInPreset(preset, 'white'), 'single-segment key');
  assert.equal(resolvesInPreset(preset, 'slate'), false, 'a scale with no DEFAULT is not a colour');
  assert.equal(resolvesInPreset(preset, 'slate-950'), false, 'a step that does not exist');
});

test('a fixture using only real tokens passes', () => {
  const report = assertClassesResolve({ files: sourceFiles(RESOLVES), preset });
  assert.equal(report.unresolved.length, 0);
  for (const cls of ['bg-surface', 'border-slate-200', 'text-ink-2', 'fill-green-500', 'stroke-amber-600', 'ring-cobalt-500']) {
    assert.ok(report.matched.includes(cls), `expected the scanner to match ${cls}`);
  }
});

test('classes that touch none of our families are skipped, not judged', () => {
  const families = familiesOf(preset);
  const matched = scanClasses('border-b text-center bg-gradient-to-br border-coral-line', { families });
  assert.deepEqual(matched, []);
});

test('the fixture that must fail, fails — naming every broken class and only those', () => {
  let error;
  try {
    assertClassesResolve({ files: sourceFiles(UNRESOLVED), preset });
  } catch (thrown) {
    error = thrown;
  }
  assert.ok(error instanceof Error, 'the broken fixture did not fail the check');

  for (const cls of ['bg-slate-950', 'border-surface-raised', 'text-ink-4']) {
    assert.match(error.message, new RegExp(cls.replace(/-/g, '\\-')), `expected ${cls} to be reported`);
  }
  assert.doesNotMatch(error.message, /coral/, 'a retired family is not ours to judge');
  assert.match(error.message, /3 Tailwind class\(es\)/);
});

test('an empty file list is an error, never a pass', () => {
  assert.throws(() => assertClassesResolve({ files: [], preset }), /the file walker is not reaching the source/);
});

test('a scan that matches nothing is an error, never a pass', () => {
  const noClasses = join(HERE, 'fixtures', 'unresolved', 'Broken.tsx');
  assert.throws(
    () => assertClassesResolve({ files: [noClasses], preset, prefixes: ['divide'] }),
    /silently matching nothing/,
  );
});

test('a preset with no colours is an error, never a pass', () => {
  assert.throws(() => assertClassesResolve({ files: [join(RESOLVES, 'Good.tsx')], preset: { theme: {} } }), /nothing could ever be judged against it/);
});

// The walk skips `node_modules`, `dist` and `.git` only as whole path segments
// below the root it was given. It used to test `/node_modules|dist|\.git/`
// against the whole absolute path, so each tree below lost files it should
// have scanned, and the guard judged fewer files without saying so. The same
// three trees as the console's own walk test (kodera-console #125), so the two
// can be held to one behaviour until the console drops its copy.
function walked(files, under = '') {
  const base = mkdtempSync(join(tmpdir(), 'source-walk-'));
  try {
    const root = join(base, under);
    for (const file of files) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), '');
    }
    return sourceFiles(root)
      .map((path) => relative(root, path).split(sep).join('/'))
      .sort();
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

test('the walk scans a name that only contains a skipped name', () => {
  assert.deepEqual(
    walked([
      'features/distribution/Card.tsx',
      'features/redistribute.ts',
      'features/dist.ts',
      'app/.github-like/x.ts',
      '.github/scripts/check.ts',
      'ui/Button.tsx',
    ]),
    [
      '.github/scripts/check.ts',
      'app/.github-like/x.ts',
      'features/dist.ts',
      'features/distribution/Card.tsx',
      'features/redistribute.ts',
      'ui/Button.tsx',
    ],
  );
});

test('the walk skips node_modules, dist and .git as whole segments, at any depth', () => {
  assert.deepEqual(
    walked([
      'node_modules/pkg/index.js',
      'features/dist/bundle.js',
      'features/nested/node_modules/pkg/index.js',
      '.git/hooks/pre-commit.js',
      'ui/Button.tsx',
    ]),
    ['ui/Button.tsx'],
  );
});

test('the walk judges only the segments below the root, not the checkout around it', () => {
  assert.deepEqual(walked(['features/Home.tsx'], join('dist', '.github', 'node_modules', 'src')), ['features/Home.tsx']);
});
