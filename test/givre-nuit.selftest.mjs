// "Givre & Nuit" (v0.5.0): the properties zôÖma approved, read from the
// source, so a later value change that undoes one fails here with a sentence
// instead of passing every other gate.
//
//   no gradient     every theme's page-grad is flat: each stop is the page (D-UI3)
//   dark steps      dark grounds get lighter in order, inverse to elevated
//   near-black rail every theme's inverse (the rail) is near-black
//   own hover       action-hover is each theme's own primitive, never another
//                   theme's cobalt
//   action rows     the fill is gated at 3:1 on surface and page in every theme
//   radius ladder   sm < md < lg < xl, with md 10, lg 16, xl 20
//
// Each clause has a mutation below that asserts its own message.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, indexTokens, resolve, parseColor, luminance } from '../scripts/lib/tokens.mjs';

const tree = JSON.parse(readFileSync(join(ROOT, 'tokens.json'), 'utf8'));
const register = JSON.parse(readFileSync(join(ROOT, 'contrast-pairs.json'), 'utf8'));

const THEMES = ['light', 'dark', 'black'];
/** Darkest first: the rail, then the page, sidebar, work area and overlays. */
const DARK_STEPS = ['inverse', 'page', 'sunken', 'surface', 'elevated'];
/** The rail is near-black in every theme: below this relative luminance. */
const RAIL_MAX_LUMINANCE = 0.02;
const RADII = { md: 10, lg: 16, xl: 20 };

const lum = (theme, role, index) => luminance(parseColor(resolve(`semantic.theme.${theme}.${role}`, index)));

function checkNoGradient(source) {
  const index = indexTokens(source);
  for (const theme of THEMES) {
    const page = resolve(`semantic.theme.${theme}.page`, index);
    const stops = resolve(`semantic.theme.${theme}.page-grad`, index);
    stops.forEach((stop, i) => {
      assert.equal(
        stop.color.toUpperCase(),
        page.toUpperCase(),
        `${theme}.page-grad: stop ${i} is ${stop.color}, not the flat page ${page} (no gradient, D-UI3)`,
      );
    });
    for (const [role, token] of Object.entries(source.color[`theme-${theme}`])) {
      if (role.startsWith('$') || role === 'page-grad') continue;
      assert.notEqual(token.$type, 'gradient', `${theme}.${role}: a gradient role (no gradient, D-UI3)`);
    }
  }
}

function checkDarkSteps(source) {
  const index = indexTokens(source);
  for (let i = 1; i < DARK_STEPS.length; i += 1) {
    const [lower, upper] = [DARK_STEPS[i - 1], DARK_STEPS[i]];
    assert.ok(
      lum('dark', lower, index) < lum('dark', upper, index),
      `dark: ${lower} must be darker than ${upper}, or the surfaces stop separating`,
    );
  }
}

function checkRail(source) {
  const index = indexTokens(source);
  for (const theme of THEMES) {
    const l = lum(theme, 'inverse', index);
    assert.ok(l < RAIL_MAX_LUMINANCE, `${theme}.inverse: luminance ${l.toFixed(4)} is not a near-black rail`);
  }
}

function checkOwnHover(source) {
  for (const theme of THEMES) {
    const ref = source.semantic.theme[theme]['action-hover'].$value;
    assert.match(
      ref,
      new RegExp(`^\\{color\\.theme-${theme}\\.`),
      `${theme}.action-hover: ${ref} is not this theme's own primitive`,
    );
  }
}

function checkActionRows(pairs) {
  for (const theme of THEMES) {
    for (const bg of ['surface', 'page']) {
      const id = `theme.${theme}/action/${bg}`;
      const row = pairs.pairs.find((r) => r.id === id);
      assert.ok(row, `${id}: the action fill must be a gated row`);
      assert.equal(row.fg, `semantic.theme.${theme}.action`, `${id}: must measure the action fill`);
      assert.equal(row.bg, `semantic.theme.${theme}.${bg}`, `${id}: must measure against ${bg}`);
      assert.ok(row.min >= 3 && !row.expect, `${id}: must be normative at 3:1 or more`);
    }
  }
}

function checkRadius(source) {
  const px = (name) => Number(/^(\d+)px$/.exec(source.radius[name].$value)?.[1]);
  const ladder = ['sm', 'md', 'lg', 'xl'];
  for (let i = 1; i < ladder.length; i += 1) {
    assert.ok(px(ladder[i - 1]) < px(ladder[i]), `radius: ${ladder[i - 1]} must be smaller than ${ladder[i]}`);
  }
  for (const [name, value] of Object.entries(RADII)) {
    assert.equal(px(name), value, `radius.${name}: ${px(name)}px, decided ${value}px`);
  }
}

const mutate = (edit) => {
  const copy = structuredClone(tree);
  edit(copy);
  return copy;
};

test('no theme paints a gradient', () => checkNoGradient(tree));
test('dark grounds get lighter in order, from the rail to overlays', () => checkDarkSteps(tree));
test('the rail is near-black in every theme', () => checkRail(tree));
test('each theme hovers with its own cobalt', () => checkOwnHover(tree));
test('the action fill is gated at 3:1 on surface and page in every theme', () => checkActionRows(register));
test('the radius ladder rises and holds the decided steps', () => checkRadius(tree));

test('every clause fails on its own mutation', () => {
  assert.throws(
    () => checkNoGradient(mutate((t) => (t.color['theme-dark']['page-grad'].$value[1].color = '#161D25'))),
    /dark\.page-grad: stop 1 is #161D25, not the flat page #0B0E14 \(no gradient, D-UI3\)/,
  );
  assert.throws(
    () =>
      checkNoGradient(
        mutate((t) => (t.color['theme-light']['brand-grad'] = structuredClone(t.color['theme-light']['page-grad']))),
      ),
    /light\.brand-grad: a gradient role \(no gradient, D-UI3\)/,
  );
  assert.throws(
    () => checkDarkSteps(mutate((t) => (t.color['theme-dark'].surface.$value = '#0D1017'))),
    /dark: sunken must be darker than surface, or the surfaces stop separating/,
  );
  assert.throws(
    () => checkDarkSteps(mutate((t) => (t.color['theme-dark'].elevated.$value = '#121722'))),
    /dark: surface must be darker than elevated/,
  );
  assert.throws(
    () => checkRail(mutate((t) => (t.color['theme-light'].inverse.$value = '#2F3A45'))),
    /light\.inverse: luminance 0\.0406 is not a near-black rail/,
  );
  assert.throws(
    () => checkOwnHover(mutate((t) => (t.semantic.theme.dark['action-hover'].$value = '{color.cobalt.500}'))),
    /dark\.action-hover: \{color\.cobalt\.500\} is not this theme's own primitive/,
  );
  const withoutRow = structuredClone(register);
  withoutRow.pairs = withoutRow.pairs.filter((r) => r.id !== 'theme.black/action/page');
  assert.throws(() => checkActionRows(withoutRow), /theme\.black\/action\/page: the action fill must be a gated row/);
  const repointed = structuredClone(register);
  repointed.pairs.find((r) => r.id === 'theme.dark/action/surface').bg = 'semantic.theme.dark.elevated';
  assert.throws(() => checkActionRows(repointed), /theme\.dark\/action\/surface: must measure against surface/);
  const loosened = structuredClone(register);
  loosened.pairs.find((r) => r.id === 'theme.light/action/surface').min = 2;
  assert.throws(() => checkActionRows(loosened), /theme\.light\/action\/surface: must be normative at 3:1 or more/);
  assert.throws(
    () => checkRadius(mutate((t) => (t.radius.lg.$value = '24px'))),
    /radius: lg must be smaller than xl/,
  );
  assert.throws(
    () => checkRadius(mutate((t) => (t.radius.md.$value = '8px'))),
    /radius\.md: 8px, decided 10px/,
  );
});
