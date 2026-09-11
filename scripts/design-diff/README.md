# Design diff

A deterministic, advisory **designer notification filter** for PRs targeting `staging`.
It reports supported changes to authored appearance. It does not run application code,
a build, a browser, AI, proposed configuration or plugins.

```sh
bun run design:diff --base origin/staging --head HEAD --output /tmp/design-diff.json
```

Use Bun **1.4.1** and complete Git history. Revisions resolve to immutable commits;
the comparison is `merge-base(base, head)..head`. Uncommitted files are not analyzed.
With `--output`, JSON is written atomically and findings stay out of logs.

| Result | JSON | Exit |
| --- | --- | --- |
| Completed, no qualifying appearance edit | `status: completed`, `flagged: false` | 0 |
| Completed, qualifying appearance edit | `status: completed`, `flagged: true` | 0 |
| Missing history, unreadable objects, invalid invocation or resource failure | `status: failed`, `flagged: null` | Nonzero |

## Designer policy (version 5)

The public decisions remain `flag` and `exempt`. **Uncertainty alone does not flag.**
Coverage limitations describe what was not established; `flagged: false` is not a claim
that every rendered pixel is unchanged.

| Change | Decision |
| --- | --- |
| Supported colour, background, gradient, border, radius, shadow, opacity | Flag |
| Supported typography, dimensions, padding, margins | Flag |
| Explicit gaps, alignment, positioning mode, flex/grid sizing, wrapping | Flag |
| Authored display/overflow/clipping/layering, animation or scale | Flag |
| Changed shared component styles, CSS variables, themes or CVA definitions | Flag |
| New control/panel with new custom CSS, layout or class overrides | Flag |
| Adding an imported shared component without custom appearance | Exempt |
| Additional dropdown options, rows or controls repeating existing appearance | Exempt |
| Copy, progress/error labels, pricing/privacy wording, documentation prose | Exempt |
| Icons, images, screenshots, inline SVG and media element dimensions | Exempt |
| Font files and font-face changes | Flag |
| Runtime conditions, functional visibility, option data, unknown component props | Exempt |
| Coordinates or translation alone | Exempt |
| Unknown calls, parser/expression limits, plugins and dependency version changes alone | Exempt; retain coverage notes |
| Comments, erased types, supported formatting/constant hoists/local renames | Exempt |

Deleting a shared control also exempts its standard appearance props. Deleted component modules
with no resolved references outside other deleted files are treated as unestablished runtime use,
not designer notifications. Route entry files and active component removals retain normal analysis.

A new `<Button variant="primary" size="sm"/>` uses shared appearance and is exempt.
Adding `<Button className="rounded-none p-6"/>` introduces a custom override and flags.
Changing an existing control's supported `variant`, `size`, classes or style values flags.
Known style values in conditional branches and React state updates are compared; changing
only the runtime predicate, handler or label does not qualify.

Media exclusion applies to recognized JSX/HTML/MDX media elements and asset files, not an
arbitrary wrapper around an image. A wrapper's custom padding or layout still qualifies.
CSS asset URL substitutions and generated copy are exempt. Source-only analysis cannot
reliably identify every project-specific media wrapper.

## How it works

```mermaid
flowchart LR
  Git[Immutable before/after Git objects] --> Graph[Find affected bindings and consumers]
  Graph --> Parse[Parse authored appearance inputs]
  Parse --> Resolve[Resolve supported values and theme CSS]
  Resolve --> Compare[Compare appearance values]
  Compare --> Flag[Concrete appearance edit: flag]
  Compare --> Exempt[Content, reuse or uncertainty: exempt]
  Flag --> JSON[Grouped JSON artifact]
  Exempt --> JSON
```

Babel parses TypeScript/JSX, PostCSS parses CSS, parse5 parses HTML and remark parses MDX.
Production extraction focuses on classes, styles, recognized appearance props and native
desktop appearance settings. It skips copy, render guards, arbitrary props and media trees.
Parser failures and bounded unsupported inputs are reported as limitations without becoming
notifications. Application code and configuration are never imported or evaluated.

The import graph is a candidate finder. Specific values are traced through supported constants,
object properties, aliases, re-exports, helpers, CSS variables and class composition. Unchanged
style expressions do not qualify because an unrelated backend dependency changed. Unknown
helper fingerprints and captured inputs are not concrete appearance evidence.

Tailwind **4.3.3** and **tailwind-merge 3.6.0** are pinned direct dependencies. Normalization uses
core utilities and declarative theme/utility/variant CSS from each application. The trusted EMCN
`cn` merge convention includes repository font-size groups. CSS declaration and class composition
order remain significant. Arbitrary JavaScript plugins, external CSS and unknown class helpers
are not executed. Supported core styling can still flag alongside unresolved custom styling.

Appearance definitions are matched by source context and supported values. Repeated styles are
matched across insertions so adding another option does not shift all later findings. Structural
matching is approximate. Changes to unused authored styles and inactive variants can still flag;
runtime-only effects and unsupported rendering may be missed by this precision-oriented policy.

The scope covers product, landing pages, emails, documentation presentation, desktop and shared
components/themes under `apps/` and `packages/`. Tests, fixtures, public image/media assets and server sandbox
bundles are excluded. Font assets remain in scope. Recognized media import modules and resolved icon origins handle aliases.
Media component modules remain available to import resolution so excluding
an Icon does not break resolution of Button through the same barrel.

## Report contract

Schema **3.0.0**, engine **0.5.1**, policy **5.0.0**. The schema remains compatible; the policy
meaning changes. Readers must inspect versions when comparing historical qualification rates.
All decisions and identifiers are deterministic for the same engine/configuration and commits.
Execution timing and peak memory are recorded separately by the benchmark, never in engine JSON.

Each top-level finding groups evidence by **changed source file**. A shared Button edit produces
one group, rather than one notification per use. Fields include:

- `source.before` / `source.after`: changed file and Git blob, or `null`.
- `decision`, `category`, `reason`, `symbol`, `before`, `after`: representative evidence.
- `changes`: individual direct source changes and their values/locations.
- `example`: one resolved consumer; its `basis` distinguishes changed evidence from a potential use.
- `impact.before` / `impact.after`: partial counts and locations of resolved static references.
- `consumers`, `dependencies`, `limitations`: supporting references and coverage notes.

Counts are source references, not affected pixels or rendered instances. Unchanged consumers do
not each create a top-level finding. Once the PR qualifies and a nearby consumer has been examined,
further indirect expansion can be omitted with an explicit limitation. All changed files remain
analyzed. A clean result requires examination of all candidate consumers within configured limits.

Small literal values are preserved. Large report values use a preview, full semantic hash and
explicit truncation metadata. Defaults are **4 KiB per preview** and **5 MiB per serialized report**.
Decisions are computed before report truncation. Readers must support `$truncated`, `preview`,
`sha256`, `hashAlgorithm`, `originalBytes`, `previewBytes` and `omittedBytes`. The
`sha256-merkle-v1` hash identifies the complete typed semantic tree without expanding repeated
symbolic subtrees. Oversized reference/detail lists retain deterministic samples and omitted counts.
Large opaque resolver trees can themselves exceed the supported analysis budget; these remain
uncertainty, not evidence of an appearance edit.

Operational failures remain distinct from completed policy exemptions. Configured file-loaded
OpenAPI inputs are validated as Git data; content is exempt and malformed inputs retain diagnostic
evidence. Lockfile rendering-dependency changes retain diagnostics but do not qualify by themselves.

## Files

```text
design-diff.config.json                Repository scope, themes and conventions
.github/workflows/design-review.yml    Trusted cloud execution; artifact only
scripts/design-diff/
  cli.ts, index.ts                     Entry points and operational status
  analyze.ts, git.ts, source.ts        Git snapshots and affected-source analysis
  dependencies.ts                     Binding graph and partial usage counts
  extract/{tsx,css,documents,assets}.ts Syntax extraction
  resolve.ts, ast.ts, refactors.ts     Bounded static resolution
  state.ts, mutations.ts               Referenced state and writes
  finite.ts, environment.ts            Finite key and environment projections
  appearance.ts                       Supported appearance evidence projection
  tailwind.ts                         Pinned compiler and trusted class helpers
  compare.ts, policy.ts, movement.ts   Matching, decisions and categories
  group.ts, report.ts, semantic.ts     Grouping, full hashes and bounded JSON
  inputs.ts, document-content.ts       Documentation data handling
  infrastructure.ts                   Rendering dependency diagnostics
  memory.ts, process.ts                Resource handling
  types.ts, tsconfig.json              Report contract and isolated type check
  benchmark.ts, benchmark/comparisons.json
                                      Immutable-engine historical replay
  tests/                              Source-string/JSON fixtures and regression suites
```

This is repository automation, not a published package. Internal imports use `#design-diff/*`.
The revision-dependent CLI is deliberately outside the generic audit runner.

## Cloud execution and activation

The production workflow targets PRs against `staging`, including drafts, without path filters.
It uses the immutable default-branch engine/configuration, pinned Actions and Bun 1.4.1, read-only
permissions and a 15-minute timeout. Event commits are fetched as data; proposed application code
is neither checked out nor installed. Superseded PR runs are cancelled.

The only findings output is a JSON artifact named `design-diff-<PR>-<head SHA>`, retained for seven
days. There are no comments, labels, annotations or findings summaries. Later consumers must check
`status: completed` and the current PR/head identity. A missing, cancelled or failed run is not clean.
The workflow is advisory and no branch-protection configuration is changed.

**Activation requires the workflow and engine to reach `main`.** Its absence on the draft PR is
not evidence of a passing analysis. A temporary push-triggered benchmark branch can test a pinned
engine before activation; old benchmark and smoke runs do not validate a newer engine.

## Validation and historical replay

```sh
bun run test:scripts
bun run check:script-tests
bun run check:design-diff-types
bun run check:api-validation
bun --no-env-file scripts/design-diff/benchmark.ts \
  --engine /path/to/clean/checkout --sha <immutable-engine-commit> \
  --manifest scripts/design-diff/benchmark/comparisons.json --output /tmp/design-benchmark
```

Script test discovery includes every engine suite. Tests cover explicit appearance edits, exempt
content/reuse/media/uncertainty, shared tokens/themes/variants, matching, Git divergence/renames/
deletions/binaries/unusual names/missing history, deterministic bounded reports and non-execution.
Fixtures stay inside test strings/JSON so application builds and styling scans do not consume them.

The frozen manifest contains the original 120 comparisons plus 60 later sampled holdouts. Its
original labels use a broader visual/content policy and must not be treated as policy-5 ground
truth. Preserve original labels and document policy-specific review separately. The prior policy-4
run completed 178/180 comparisons, flagging 112; two timed out. That is historical context only.

The runner verifies exact commits and GitHub file sets. Its cache identity includes immutable
engine SHA, configuration, lockfile, runtime and comparison commits. It records elapsed time,
peak RSS, report size and failures separately. `/usr/bin/time` and Bun 1.4.1 are required. The default
per-comparison deadline is 900 seconds; failed cases remain explicit failures in rate reporting.
