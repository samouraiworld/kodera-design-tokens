# kodera-design-tokens

`@samourai/design-tokens` — the design tokens of Kodera, published as one package and consumed by both front-ends: `samourai-hub` (the marketing site) and `kodera-console` (the authenticated application).

Established by **ADR-0004** in the console repository: the tokens are a shared package, not a file copied into two repositories. Copies drift silently, and nothing errors when they disagree.

```
tokens.json                    W3C DTCG source of truth, delivered by the design workstream
dist/tokens.css                generated CSS custom properties
dist/tailwind.preset.js        generated Tailwind preset (ESM)
dist/tokens.d.ts               generated types
contrast-pairs.json            the accessibility contract, as data
contrast-known-failures.json   the explicit allowlist, one written reason per entry
token-grammar-exceptions.json  naming-grammar deviations, one written reason per entry
scripts/build.mjs              tokens.json → dist/
scripts/check-grammar.mjs      DTCG validity and the naming grammar
scripts/check-contrast.mjs     WCAG 2.1 ratios over contrast-pairs.json
test/token-test.mjs            the reusable token-resolution guard for consumers
```

Everything runs on plain Node 22 with **no dependencies and no install step**. That is not minimalism for its own sake: consumers install this package from a git tag, and npm does not run an install or a build for a git dependency. A `dist/` that needed `npm install` to exist would install as an empty package, with no error at all — which is exactly the class of failure this repository is built to make loud.

## Commands

```sh
npm run build           # regenerate dist/ from tokens.json
npm test                # the four gates, all of them, even after one fails
npm run check:grammar   # DTCG validity + naming grammar + tier counts
npm run check:contrast  # the contrast table and the gate
npm run check:drift     # dist/ equals a fresh build
```

## The three sync tests

ADR-0004 names three tests, each guarding one failure that is otherwise completely silent.

| Test | Runs here | Fails when |
|---|---|---|
| **Token resolution** | exported from here, **runs in each consumer** | A Tailwind class names one of our colour families and the token does not exist. Tailwind emits no CSS and no error; for `border-*` the element falls back to preflight's `border: 0 solid #e5e7eb`. |
| **Contrast** | here, on every PR | A declared pair falls below its WCAG minimum and is not in the allowlist with a reason — or the allowlist entry no longer describes the pair: each entry is bound to the pair's `fg`, `bg`, `min` and the ratio it was written at, so a re-pointed pair, a loosened minimum or a colour that moved fails instead of inheriting the old excuse. Translucent colours are composited before measuring; an unresolvable pair is a hard failure, never a skipped row. |
| **Version drift** | each consumer's CI | The consumer's pinned version is more than one minor behind the tag published here. Without it a repository sits on an old palette indefinitely and nothing complains. |

A fourth gate is local to this repository: **drift**, which asserts `dist/` is byte-identical to a fresh build. `dist/` is committed so consumers can install from git, and a committed build output is a copy — the same failure mode ADR-0004 rejects — unless something proves it is still generated.

## How CI is wired

Five jobs, in `.github/workflows/ci.yml`. Four do work: **Tracked dot-entries** refuses a committed dot-entry nobody vouched for, **Grammar, contrast, drift, units** runs `npm test`, **Secret scan** runs gitleaks over the whole history, **Workflow lint** runs actionlint over these workflows. The gitleaks and actionlint archives are verified by SHA-256 before extraction, against the `GITLEAKS_SHA256` / `ACTIONLINT_SHA256` env values recorded next to each pinned version in the workflow. The fifth, **`ci-ok`**, does no work of its own — it needs the other four, and every one of them must have concluded `success`. A job that concluded `skipped` fails it too, unless that job is named in the `SKIP_OK` environment variable on the step; **this repository declares none**, because no job here is conditional, so nothing may skip. That is the whole point of the rule: a skipped required check is reported to branch protection as satisfied, so adding an `if:` or a path filter to a gate would otherwise turn the merge button green precisely because the gate never ran.

`ci-ok` is the single check branch protection points at. Requiring the four working jobs by name instead would keep the gate list in repository settings, where it drifts out of step with the workflow: a renamed job leaves the old context required forever, blocking every PR on a check nothing will ever report, while the job that replaced it is required by nothing. Adding, renaming or splitting a gate is therefore a change to `ci.yml` alone.

Before it decides anything, `ci-ok` proves both of its scripts can still fail — `aggregate-result.selftest.sh` and `check-aggregate-covers-jobs.selftest.sh` — and then runs both: `check-aggregate-covers-jobs.py`, which fails if a job exists in `ci.yml` but is missing from `ci-ok`'s `needs:` (such a gate could go red while the required check stayed green), and `aggregate-result.py`, which reads the verdicts. A required check nobody has ever seen fail is a decoration, and this one is the last thing standing between a red gate and a green merge button.

## Releasing

A tag is the release: there is no registry and the package is `private: true`. The procedure — gates green on `main`, `dist/` drift-clean, the contrast register read, the decider of every value change named, an annotated `vX.Y.Z` tag, then one repin pull request per consumer — is in [`RELEASE.md`](RELEASE.md). What each tag carries is in [`CHANGELOG.md`](CHANGELOG.md).

## How the hub and the console consume it

Until GitHub Packages is set up for the organisation, both repositories take a **git dependency pinned to a tag**. A branch or a bare repository URL is not pinned: it re-resolves on every fresh install, and the palette changes underneath the consumer between two CI runs of the same commit.

```jsonc
// package.json in samourai-hub and kodera-console
{
  "dependencies": {
    "@samourai/design-tokens": "github:samouraiworld/kodera-design-tokens#v0.1.0"
  }
}
```

Tailwind:

```js
// tailwind.config.ts
import samourai from '@samourai/design-tokens/tailwind-preset';

export default {
  presets: [samourai],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // Declare nothing else. Re-declaring a colour here is how the two
  // front-ends start to disagree.
};
```

Anything outside Tailwind — the Visio theme, a raw stylesheet, an email template — reads the CSS instead:

```js
import '@samourai/design-tokens/tokens.css';
```

And each consumer runs the resolution guard as one of its own unit tests:

```js
import preset from '@samourai/design-tokens/tailwind-preset';
import { assertClassesResolve, sourceFiles } from '@samourai/design-tokens/token-test';

it('every colour class resolves to a real token', () => {
  assertClassesResolve({ files: sourceFiles('src'), preset, minFiles: 5 });
});
```

The guard throws when a class names one of our families and resolves to nothing. It also throws when it scanned no files or matched no classes, because a guard that silently judges nothing is worse than no guard.

### The version-drift rule for consumers

A consumer pinned more than **one minor** behind the newest tag here fails its own CI. One minor of slack is the review window for a token change; two is a repository nobody is updating. The rule lives in each consumer because that is where the stale pin is, and it is a CI check rather than a convention because a convention about a version number is a convention nobody enforces.

Versioning follows ADR-0004 and DESIGN_HANDOFF F5: renaming or removing a token is a **major**; a deprecation keeps the old name resolving for one minor.

## The source of truth is the design workstream's values

`tokens.json` is the design workstream's delivery. This repository generates from it and measures it; it does not **decide** it. A change to a token value is a design decision and arrives as a PR here carrying three things — the decision, the ratio it now measures in the token's `$description`, and the contrast gate green — or an allowlist entry naming the decision it is still waiting on. It is never a build fix. Three primitives have moved that way, in one signed pass: `color.slate.600`, `color.slate.700` and `semantic.border.input` (ADR-0002).

Two things the build emits are still not tokens: the frost page gradient behind `--bg-page`, and the focus ring. (The themed page gradients are tokens — `semantic.theme.*.page-grad` — and are generated from the source like any other value.) They live in `scripts/lib/spec.mjs` rather than inside the build script, because the contrast gate reads them there too — `contrast-pairs.json` measures the ring by role, so changing its geometry moves what the gate measures instead of leaving the rows describing a ring that is no longer there. The ring's colour is not one value: its core is a theme role, so `--focus-ring` and `--focus-ring-on-inverse` are declared inside each `[data-theme]` block and the light pair carries `:root` with it for a page that sets no attribute.

`dist/` is generated. Editing it by hand is undone by the next build and caught by the drift gate.

## What v0.1 is not

- **Three themes, and an older semantic tier that is still single-valued.** The dark mode ADR-0004 and DESIGN_HANDOFF A4 call for is here: `semantic.theme.light`, `.dark` and `.black` carry the same 49 roles, emitted as `--c-*` custom properties and `c-*` preset colours that follow `[data-theme]`, with light as the unthemed default. The older semantic tokens — `semantic.surface.*`, `semantic.text.*` and the rest — still hold one value each and do not follow the attribute, so migrating a component to `c-*` means auditing its surfaces, text and statuses together. Focus indication is no longer part of that audit: the ring follows the attribute on its own, and the only choice a component still makes is which of the two variants it draws (`--focus-ring` on a normal ground, `--focus-ring-on-inverse` on an inverse panel). `docs/specs/shell-themes.md`.
- **No component tier for colour.** The `component` group is no longer empty — it carries the shell geometry aliases under `component.shell.*` — but nothing in it is a colour. The first component colour token (`button.primary.fill.hover`) arrives with the console's `src/ui/` primitives.
- **No z-index ladder, no breakpoints.** DESIGN_HANDOFF A12 and A13 are owed. The preset therefore overrides neither, and Tailwind's defaults apply.
- **Four contrast pairs are exempt, and none fails.** The tertiary ink, the input border and the focus ring were fixed in the values rather than written down: `color.slate.600` and `color.slate.700` are darker — one step of the ramp does not move alone, so this darkens `text.tertiary` **and** `text.secondary` together — `border.input` is slate.500, and the ring is two-tone, an opaque core inside a 35 % halo, both following `[data-theme]`. What remains in `contrast-known-failures.json` is four rulings — the two placeholders, the retired white-on-slate.300 disabled label, and the decorative card edge — each with the trigger that would reopen it. All four read "Decided, not pending": nothing there is awaiting a decision.

## Adding a token

1. Edit `tokens.json`.
2. Add a row to `contrast-pairs.json` for every surface the token can sit on or behind. A colour with no row is unguarded, and DESIGN_SYSTEM.md forbids one.
3. `npm run build` and commit `dist/`.
4. `npm test`. If a pair fails, the fix is the value — not an allowlist entry, unless the design workstream decided otherwise and the reason says so.
5. If an allowlist entry is what the decision calls for, it carries the pair's `fg`, `bg` and `min`, the ratio measured today, a reason and a decision. `test/check-contrast.selftest.mjs` is where a new way the gate must fail gets its mutation.
