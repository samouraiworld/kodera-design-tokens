// Elevation (DESIGN_HANDOFF A10) and breakpoints (A13): what the build must
// emit, and the ways it can be wrong without any other gate noticing.
//
// A shadow frozen to one theme renders, and a breakpoint out of order compiles:
// Tailwind sorts nothing it is not asked to, and a light shadow on a dark
// ground is merely invisible. So the contract is read here, from the generated
// CSS and preset, and each clause has a mutation that turns it red.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, cpSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, indexTokens, resolve, resolveValue } from '../scripts/lib/tokens.mjs';
import preset from '../dist/tailwind.preset.js';

const tree = JSON.parse(readFileSync(join(ROOT, 'tokens.json'), 'utf8'));
const css = readFileSync(join(ROOT, 'dist/tokens.css'), 'utf8');

const THEMES = ['light', 'dark', 'black'];
/** Lowest first: the order of the z ladder (DESIGN_HANDOFF A12). */
const LEVELS = ['raised', 'overlay', 'drawer', 'dialog'];

const px = (v) => {
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(v);
  assert.ok(m, `${v}: a px dimension`);
  return Number(m[1]);
};

function themeBlock(styles, theme) {
  const selector = theme === 'light' ? ':root, \\[data-theme="light"\\]' : `\\[data-theme="${theme}"\\]`;
  return styles.match(new RegExp(`(?:^|\\n)${selector} \\{([^}]+)\\}`))?.[1];
}

function checkElevation(source, styles, config) {
  const index = indexTokens(source);
  const shadow = (theme, level) => resolve(`semantic.elevation.${theme}.${level}`, index);
  for (const theme of THEMES) {
    const levels = Object.keys(source.semantic.elevation[theme]).filter((k) => !k.startsWith('$'));
    assert.deepEqual(levels, LEVELS, `${theme}: four elevation levels, lowest first`);
    // A ladder: each level casts further and softer than the one below it.
    for (let i = 1; i < LEVELS.length; i++) {
      const [low, high] = [shadow(theme, LEVELS[i - 1]), shadow(theme, LEVELS[i])];
      assert.ok(px(high.offsetY) > px(low.offsetY), `${theme}.${LEVELS[i]}: offset rises above ${LEVELS[i - 1]}`);
      assert.ok(px(high.blur) > px(low.blur), `${theme}.${LEVELS[i]}: blur rises above ${LEVELS[i - 1]}`);
    }
    const block = themeBlock(styles, theme);
    assert.ok(block, `${theme}: CSS boundary missing`);
    for (const level of LEVELS) {
      const { offsetX, offsetY, blur, spread, color } = shadow(theme, level);
      const painted = resolveValue(color, index);
      assert.equal(
        color,
        level === 'raised' ? `{color.theme-${theme}.shadow-1}` : `{color.theme-${theme}.shadow-2}`,
        `${theme}.${level}: drawn in this theme's own shadow colour`,
      );
      assert.ok(
        block.includes(`  --elevation-${level}: ${offsetX} ${offsetY} ${blur} ${spread} ${painted};`),
        `${theme}.${level}: scoped CSS`,
      );
    }
  }
  // A dark UI cannot reuse a light shadow.
  for (const level of LEVELS) {
    const painted = THEMES.map((theme) => resolveValue(shadow(theme, level).color, index));
    assert.equal(new Set(painted).size, THEMES.length, `${level}: a distinct shadow in each theme`);
  }
  const boxShadow = config.theme.extend.boxShadow;
  for (const level of LEVELS) {
    assert.equal(boxShadow[level], `var(--elevation-${level})`, `${level}: dynamic preset`);
  }
  assert.deepEqual(
    Object.keys(boxShadow).filter((k) => k.startsWith('theme-')),
    [],
    'the themed shadow primitives stay out of the preset',
  );
}

function checkBreakpoints(source, config) {
  const steps = Object.entries(source.breakpoint).filter(([k]) => !k.startsWith('$'));
  assert.ok(steps.length >= 4 && steps.length <= 5, `four or five breakpoints, not ${steps.length}`);
  let previous = 360; // the minimum supported width; every step is wider
  for (const [name, token] of steps) {
    const width = px(token.$value);
    assert.ok(width > previous, `breakpoint ${name}: ${width}px must be wider than ${previous}px, mobile-first`);
    previous = width;
  }
  assert.deepEqual(
    config.theme.extend.screens,
    Object.fromEntries(steps.map(([name, token]) => [name, token.$value])),
    'the preset screens are the breakpoint tokens',
  );
  assert.ok(css.includes('  --breakpoint-md: 768px;'), 'breakpoints reach the CSS');
}

test('elevation: four themed levels, a ladder, distinct per theme, dynamic in the preset', () =>
  checkElevation(tree, css, preset));

test('breakpoints: four or five mobile-first px steps above 360px, carried by the preset', () =>
  checkBreakpoints(tree, preset));

test('the elevation and breakpoint contracts detect frozen, flattened and disordered values', () => {
  const frozen = structuredClone(preset);
  frozen.theme.extend.boxShadow.overlay = '0px 20px 50px -20px rgba(47,58,69,.35)';
  assert.throws(() => checkElevation(tree, css, frozen), /overlay: dynamic preset/);

  const shared = structuredClone(tree);
  shared.shadow['theme-dark'].dialog.$value.color = '{color.theme-light.shadow-2}';
  assert.throws(() => checkElevation(shared, css, preset), /dark\.dialog: drawn in this theme's own shadow colour/);

  const flat = structuredClone(tree);
  flat.shadow['theme-black'].drawer.$value.blur = '50px';
  assert.throws(() => checkElevation(flat, css, preset), /black\.drawer: blur rises above overlay/);

  const unscoped = css.replace(/(\[data-theme="dark"\] \{[^}]*?)  --elevation-raised: [^;]+;\n/, '$1');
  assert.notEqual(unscoped, css, 'the mutation removed a declaration');
  assert.throws(() => checkElevation(tree, unscoped, preset), /dark\.raised: scoped CSS/);

  const disordered = structuredClone(tree);
  disordered.breakpoint.lg.$value = '700px';
  assert.throws(() => checkBreakpoints(disordered, preset), /breakpoint lg: 700px must be wider than 768px/);

  const tooNarrow = structuredClone(tree);
  tooNarrow.breakpoint.sm.$value = '320px';
  assert.throws(() => checkBreakpoints(tooNarrow, preset), /breakpoint sm: 320px must be wider than 360px/);

  const stale = structuredClone(preset);
  stale.theme.extend.screens.md = '48rem';
  assert.throws(() => checkBreakpoints(tree, stale), /the preset screens are the breakpoint tokens/);
});

test('a shadow colour that references nothing fails the grammar gate and the build', () => {
  const dir = mkdtempSync(join(tmpdir(), 'elevation-'));
  try {
    cpSync(join(ROOT, 'scripts'), join(dir, 'scripts'), { recursive: true });
    cpSync(join(ROOT, 'token-grammar-exceptions.json'), join(dir, 'token-grammar-exceptions.json'));
    const run = (script) => spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8', env: {} });

    writeFileSync(join(dir, 'tokens.json'), JSON.stringify(tree));
    assert.equal(run('scripts/check-grammar.mjs').status, 0, 'the unmutated source passes');
    assert.equal(run('scripts/build.mjs').status, 0, 'the unmutated source builds');

    const dangling = structuredClone(tree);
    dangling.shadow['theme-dark'].overlay.$value.color = '{color.theme-dark.shadow-9}';
    writeFileSync(join(dir, 'tokens.json'), JSON.stringify(dangling));
    const grammar = run('scripts/check-grammar.mjs');
    assert.notEqual(grammar.status, 0);
    assert.match(grammar.stderr, /shadow\.theme-dark\.overlay {2}\[alias\] {2}color: dangling reference: "color\.theme-dark\.shadow-9"/);
    const build = run('scripts/build.mjs');
    assert.notEqual(build.status, 0);
    assert.match(build.stderr, /dangling reference: "color\.theme-dark\.shadow-9"/);

    const missing = structuredClone(tree);
    delete missing.semantic.elevation.black.dialog;
    writeFileSync(join(dir, 'tokens.json'), JSON.stringify(missing));
    const incomplete = run('scripts/build.mjs');
    assert.notEqual(incomplete.status, 0);
    assert.match(incomplete.stderr, /black: incomplete elevation level set/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
