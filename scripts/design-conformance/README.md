# Design conformance check

Tool **3.10.7**, policy **design-conformance/1.9.1**. This is the maintained implementation of Sim's design guardrails.

Advisory review now distinguishes complete EMCN recipe use on native controls from locally authored chrome: pure `chipVariants`, `chipGeometryClass`, and `dropdownMenuRowClass` uses do not create a `local-control` item. Caller visual additions and unresolved classes produce `emcn-recipe-override` review items; partial recipes remain local controls. Repeated-treatment review requires visible chrome or interaction evidence; generic layout repetitions remain local. Computed `<style>` sources are labeled separately for customer branding, Monaco tooltip geometry, preview disabled appearance, and preview cursor selectors. All computed CSS retains an unchecked diagnostic, and direct modal-body overrides remain confirmed component findings.

Direct `box-shadow`/`text-shadow` values may reference a complete `--shadow-*` recipe defined in `globals.css`. A local override of that recipe remains unchecked, a missing token remains a finding, and a plain colour token does not qualify as a complete shadow.

Monaco's `monaco.editor.defineTheme` colour table and syntax rules are treated as editor-owned presentation, so they do not produce colour findings or syntax-colour review items. Other product styling in the same module, including rendered HTML/CSS and app-authored controls, remains checked. Other `defineTheme` APIs are not exempt.

Registered block catalogue `bgColor` and `iconColor` values (`category: 'blocks'`, `'triggers'` or `'tools'`) are intentional per-block identity colours, so neither command reports those metadata fields as product styling. The surrounding source file remains in scope for actual product UI and unrelated colour recipes. This applies equally to built-in blocks, triggers and provider integrations.

From the repository root, using Bun **1.4.1** and the normal root installation:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check:design --base origin/staging --working-tree
bun run check:design --base origin/staging --head HEAD
bun run check:design --base origin/staging --format json --output /tmp/design-report.json
bun run design:scan --repo . --working-tree --output /tmp/sim-design-scan
```

Use the actual PR target for `--base`; it is required. The repository defaults to this checkout, and the head defaults to `HEAD`. `--repo` accepts another complete Git checkout. `--working-tree` compares the merge base with tracked, staged, unstaged and nonignored new source. `--head HEAD` compares immutable commits and is the CI mode. No application build, application/configuration/plugin execution, AI, network review or automatic fixes occur.

## Results and CI

- **Usage violations** identify newly introduced inputs that violate an explicit central design contract, the authoritative definition, and the permitted token/component mechanism. Fix confirmed violations through that mechanism.
- **System changes** identify edits to central definitions or this registry. Review them as changes to the design system; central authoring may introduce new styling.
- **Unchecked inputs** describe unresolved syntax or coverage limits. They do not create findings, and a clean result does not prove exhaustive conformance. Text output identifies incomplete coverage and lists every diagnostic with its file, line, comparison side, context and reason. The CI summary includes an expandable list of the first 100 diagnostics, with long entries shortened; complete details remain in the check log and JSON report.
- **Advisory review items** identify possible shared recipes, local controls, editor-generated controls, artwork and other source-owned visual decisions. They are not proven violations. `reviewItems` in JSON and the text report keep them separate from `findings`.
- **Coverage failures** identify changed product files whose styling cannot be parsed or extracted, including files over the 2 MiB limit. They appear in `coverageFailures` and make the local comparison fail with exit 2 and `flagged: null`. Other unresolved flows remain in `unchecked`.

The ordinary command exits **0** for no findings, **1** for findings and **2** for operational failure. JSON retains `flagged: true` even during the warning-only rollout; failed reports have `flagged: null`.

Local runs can pass `--reviews /absolute/path/reviews.json` to attach external source-fingerprint decisions. The file must be outside the audited product checkout. Each entry needs `version: "1.0.0"`, an exact `fingerprint`, `status` (`retained-extra`, `designer-review` or `false-positive`), `rationale` and `evidence`. `reviewDecisions` reports matched, stale and ambiguous entries; classification never removes a raw finding or proves a token origin. Line shifts do not change fingerprints, and duplicate candidate sites deliberately require renewed review.

The dedicated CI step emits warning annotations and a job summary for both finding types. It accepts exit 1 only alongside a fresh completed report proving that findings exist. Missing refs, missing central inputs, startup errors, signals and output failures still fail CI. It uses immutable PR base/head SHAs or the entire push's before/after SHAs, with full Git history. Manual runs and new branches use the previous commit as their fallback base. There is no automatic transition to blocking findings, no PR-comment bot and no local hook installation.

## Policy and maintenance

`contracts.json` records governing rules, central guidance, component ownership and supported composition. Colours and typography require central provenance; radii/shadows are governed where central families exist. Approved building blocks may be combined freely. Other geometry and layout remain unrestricted unless an explicit component/slot rule applies. Documented branding inputs and artwork exclusions remain supported.

The component registry now covers basic labels, text areas, comboboxes, checkboxes, switches, tags, avatars, banners, code surfaces, dropdown and popover rows, OTP slots, and simple forwarding controls in addition to Button, Badge, Input and the Chip family. It checks only properties each component actually owns. For example, Skeleton owns its fill while callers choose its dimensions and shape; OverflowText owns clipping while callers choose typography; Banner owns its root fill and padding while its text styling remains caller controlled. `Code.Viewer` owns container radius, border and background, so those caller classes are reported individually even when their values come from global tokens. A finding calls for review of a supported prop, shared variant or explicit Extra; it does not itself prove a visual defect.

The full scanner imports the same maintained analysis modules as the diff linter. The mirrored property list is checked against the diff linter's registry by a tooling test. The supplemental scan matches resolved EMCN exports and statically visible `className` branches; unsupported styling flows remain subject to the existing unchecked diagnostics and general token checks.

The checker reads the fixed central inventory at the immutable merge-base, then overlays proposed central definitions for their consumers. It does not infer approval from application repetition or equal literal values. Unchanged debt stays quiet; new copies remain eligible. Moving noncompliant inputs to another file or component, including supported extraction and Git renames, now notifies. Wording-only edits and unchanged authored inputs within the same owner remain quiet. Both the legacy and integrated registry locations are recognized as central-system changes.

Styling extraction remains bounded to changed modules plus the fixed central inventory. The control simplification pass described below also reads unchanged product dependencies. Unknown helpers/imports, unsupported control flow, complex dynamic recipes and runtime cascade/inheritance remain unchecked. Parse and extraction errors are distinguished; either error in a changed product file fails the comparison. Source limit: 2 MiB; resolution depth: 12; additional summary metadata: 32 MiB. Other bounded caches and exclusions remain encoded in the registry and implementation. Central selector repairs and Tailwind source-scanning changes notify even when they restore intended styles. Frozen historical comparisons are development data, not measured unseen accuracy.

Debt matching is scoped to the same file, owner, contract and explicit styling input, with occurrence counts preserved. An unrelated deletion cannot cancel newly surfaced debt. Approved constant/import refactors remain quiet because they contain no violation. Central equivalent refactors still use bounded delegation matching. Reordering identical inputs within one owner is not reconstructed as a runtime move.

Modal field-spacing checks require recognizable field/control structure. Ordinary prose, lists and the word "Fields" do not establish a field group. Direct overrides of the central modal body's own protected styling remain findings. Whole-owner relocation of central styling requires direct delegation; inserting a nested helper does not transfer the parent's definitions.

The registry can explicitly designate styling exports in other central modules. Currently this includes the workflow canvas layer rules. Only registered exports and their bounded local dependencies contribute to recipe changes; ordinary application metadata does not become central. Literal values, arithmetic, simple conditionals and function returns are normalized without execution. Unknown helper replacements remain unchecked. Historical snapshots record which recipe paths were searched, including absent paths; older snapshots lacking this evidence report incomplete coverage, and an omission proven by immutable source fails the comparison.

The root command uses `command.ts` and the same analyzers as the raw CLI. `reporting.ts` formats findings; `ci.ts` resolves event revisions and implements the warning rollout. Policy decisions belong in the analyzers and registry, never in CI formatting.

Tests live in root-level `scripts/check-design-conformance*.test.ts` suites, collected by the existing script-test runner. Use generic paired examples and retain legacy regressions:

```sh
bun run test:scripts
bun run check:script-tests
bun run type-check:design
bun run lint:check
```

Root formatting/lint commands cover these modules and tests. Root type checking includes their focused configuration. The implementation hash includes the sorted source modules, entry point, registry, root manifest and shared lockfile, cached once per process; policy and registry identities change only when their semantics change.

## Control simplifications

The conformance commands also run shared `control-*.ts` analysis against complete merge-base and selected head source trees (immutable commits in CI, the current working tree locally). Files are parsed as data, never imported or executed. Unchanged imports, barrels, central recipes and icon definitions participate in resolution. The full audit exposes all findings; the PR check matches occurrence counts by file, owner, rule and value, reporting only introduced occurrences. Line shifts do not create debt and another copy does. Central changes can expose new consumer findings in unchanged files.

Three stable rules add source-backed cleanup evidence:

- `control-redundant-style`: resolve direct central CVA renderers, defaults, variants, compound variants, ordered immutable spreads and finite inputs. A candidate must occur in every active central alternative; removing it must preserve the final merged token set for every consumer/recipe combination. Conflicting utilities, modifiers, important flags and variant differences retain their meaning. The full EMCN `cn` AST and pinned `tailwind-merge` 3.6.0 configuration are verified; an unfamiliar merger or unsupported renderer yields an analysis gap. This is a removal proof, not permission to replace a utility with an approximately equivalent one.
- `control-accessible-name`: check native JSX buttons and resolved EMCN Button/Chip implementations. Recognize labels, resolvable same-owner `aria-labelledby`, text (including screen-reader text), titles and decorative icon content. Tooltip descriptions alone do not name a control. Dynamic names, children, unresolved label references and unknown spreads remain explicit gaps. Findings identify missing names; they do not invent wording or automatically edit callers. This bounded source check is not a complete browser accessibility audit.
- `control-duplicate-artwork`: fingerprint static SVG drawings using exact shape attributes, ordered children, viewBox and explicit paint. Root presentation such as caller class/size is separate from drawing identity. Equivalent drawings are extraction candidates; callers must preserve their presentation and accessibility. Different outlines, paint, transforms or geometry are distinct. Dynamic or unsupported drawings remain unresolved.

The analysis shares the existing bounded lexical inventory and records its diagnostics alongside rule-specific gaps. These rules cover supported JSX control implementations; imperative DOM, arbitrary helpers, runtime CSS and dynamic component behavior are not proven safe to change. Source parsing is limited to 2 MiB per module, naming/drawing traversal to bounded static structures and recipe combinations to 64. Overlapping original styling findings remain visible; full-audit simplifications carry their own IDs and links to original findings where their source locations coincide. CI remains warning-only.

The integrated full scanner imports these same modules directly. Its `simplifications.json`, `.csv` and summary contain proof details, remaining findings and uncertainty. Neither command depends on previous local audit artifacts. Legacy policies and historical dataset replay retain their styling-only behavior because those snapshot formats do not include complete control source trees.

## Local colour-variable assignments

Both the PR command and the integrated full scanner now run the shared `control-colour-assignments.ts` pass. `central-colour-assignment` checks the writer as a separate occurrence, so changing only an assignment (or its imported constant) cannot hide behind an unchanged `var(--alias)` usage warning. The PR report's `colourAssignments` contains before/after coverage and introduced counts; the full scanner also writes `colour-assignments.json` with individual verified, invalid and unresolved assignments.

The authority is the actual `apps/sim/app/_styles/globals.css` in each snapshot, not a list of accepted variable names or Tailwind's implicit palette. Colour variables are identified from colour uses and assigned values. CSS declarations (including `@property` initial values), Tailwind custom-property classes, JSX style objects, statically resolvable prop spreads, React `createElement` props, `CSS.registerProperty` defaults, `style.setProperty`, style member writes, `cssText`, `setAttribute('style', ...)`, and `Object.assign(style, ...)` are inspected. Unsupported escaped property names remain unresolved writes. The existing bounded lexical resolver handles immutable constants, imported aliases/barrels/namespaces, conditional alternatives and style-object spreads. Numeric sizing variables are not automatically colour variables.

Every assigned alternative and every `var()` fallback must reach an existing global colour token, including local alias chains and local overrides of a global token. Missing definitions, literal colours, non-colour tokens and bad fallbacks produce findings. Runtime values, computed property names, unknown style spreads, inherited `currentColor` and cyclic/over-depth aliases produce unchecked diagnostics when an assignment cannot be verified. No automatic exemption is granted to collaborator colours. Unsupported/opaque prop forwarding and parser/size limits remain explicit analysis diagnostics; this is not arbitrary JavaScript execution or a proof of runtime CSS inheritance/cascade.

Verified assignments now feed colour-usage checking in both commands. A `central-colour` usage of a local alias is resolved only when its complete emitted colour expression (including every fallback) and every discovered writer/alias dependency lead to existing global colour tokens. Local overrides are checked even through global-token alias chains. No variable-name whitelist is used. Component-chrome, shadow and other findings are never removed by colour provenance. The report records resolved sites and their global references in `verifiedUsages`; the full report also retains the variable-resolution table and inspected use sites.

A valid fallback cannot excuse an invalid, missing or runtime primary alias. Bad assignment/import/global-token edits keep their independent assignment findings, and deleting the last verified local writer flags its unchanged uses in diff mode. Unknown style keys/spreads remain unchecked; opaque prop forwarding and unsupported source remain diagnostics even when an independently resolved usage is cleared. This is provenance checking of discovered source values, not proof of CSS selector applicability, runtime inheritance/cascade or complete source coverage. An unresolved writer or coverage gap must not be treated as proven conformance. Central authoring and landing exclusions retain their existing policy. The maintained classifier resolves local-alias warnings after analysis.

## Reviewed shadow Extras

`control-shadow-extras.ts` contains exactly three approved source treatments: the document divider selection band in light/dark and the browser progress glow. They are one-off effects, not elevation shadows. Both public commands use the same classifier.

Approval requires the exact CSS file, root-level selector, one root rule, ordered complete declaration recipe, dimensions, units, layers, palette references and opacity. `!important`, new declarations, duplicate rules/declarations, nested at-rules, widened selectors, copied source sites or altered values do not inherit approval. Referenced colour tokens must be real global colours, and discovered local overrides revoke approval. Invalid/dynamic colour assignments still have their independent findings. This does not prove all runtime cascade or arbitrary JavaScript; it grants no general shadow, file, selector-name or comment exemption.

Approved occurrences remain visible in the diff JSON's `shadowExtras` and full audit's `shadow-extras.json`. Only their exact `central-shadow` finding is reclassified; colour, radius and other findings survive. A separate recipe guard makes geometry-only edits or missing/overridden global tokens newly visible even when the raw shadow text is unchanged baseline debt. Legitimate treatment changes therefore require explicit policy review. Editing/disabling the linter itself still needs repository review; this is not a security boundary against someone allowed to rewrite the checker.

## Artwork, scope and agent judgment

The registry declares central artwork libraries: EMCN `icons/`, EMCN `illustrations/` (available for new assets), and the shared `apps/sim/components/iso/` library. Reuse is quiet; added, changed and removed assets notify as system changes. Source assets are parsed without execution and formatting/comments are normalized. CSS, SVG files and raster assets use Git blob identity; even a metadata-only asset edit can warn. Their blob identities appear in evidence; asset definitions are separate from the historical colour/theme snapshot because they do not authorize consumer styling values.

New or changed local JSX SVG drawings notify as artwork ownership violations. Visible SVG chart text retains ordinary typography checks. User-uploaded media, provider branding inputs and ordinary media content remain exempt. `brandAssets` explicitly records sanctioned third-party glyphs, including their direct barrel exports; arbitrary component names or comments never create this exemption. The legacy mixed `apps/sim/components/icons.tsx` file remains explicitly excluded with an unchecked diagnostic; separating provider logos from product icons is a follow-up ownership task. Artwork expressions are compared as authored syntax; changes solely inside an opaque helper or an unchanged local reference may remain unchecked. Arbitrary HTML/CSS illustrations are not guessed from names or `aria-hidden`; normal governed styling rules still apply. Use central libraries for future product artwork, with the designer owning the shared asset rather than every internal coordinate. This release does not relocate or retroactively approve all existing artwork, and does not enforce a universal icon size.

Landing and docs routes remain excluded, including `apps/sim/app/(docs)/`, `apps/docs/`, and content files. `ownership` in the reviewed registry can declare landing-only source outside those routes, with its governing owner and reason. The consent preferences trigger is declared there because both callers belong to landing pages. Product reuse must remove that declaration; the checker does not build a repository-wide caller graph. Registry changes themselves notify, so scope declarations are reviewable.

Agents should fix obvious consumer mistakes through the cited central mechanism. A small local gray correction can choose a suitable approved token from its role; significant shared or ambiguous changes require a conversation with the engineer. Intentional design changes and explainable exceptions can proceed with a PR explanation; warnings remain visible. Do not manufacture new tokens, broaden exemptions or suppress output to pass a check. The detector performs no automatic edits. Root `AGENTS.md` and the existing EMCN review skill describe this workflow.

Changes to the checker, its registry, invocation or CI workflow require ordinary engineering review. A checker cannot guarantee its own integrity if the proposed branch deletes or disables it; this release adds no approval gate or branch-protection mechanism.

## Compatibility and maintainer replay

The raw CLI retains its JSON interface, explicit arguments and 0/1/2 exit codes:

```sh
bun --no-env-file scripts/design-conformance/cli.ts --repo . --base origin/staging --head HEAD
bun run check:design --base origin/staging --policy appearance
bun run check:design --base origin/staging --policy tokens
```

`--catalogue` is supported only for the legacy policies (`appearance-diff/2.1.0`, `token-lint/2.0.0`). Their original catalogue bytes are preserved. Conformance rejects that option and uses its separate contracts and central-source snapshots.

Historical datasets, snapshots, reports and archived implementations are external research artifacts, never dependencies of a normal check or the test suite. The small maintainer entry points can replay those artifacts when supplied explicitly:

```sh
bun --no-env-file scripts/design-conformance/evaluate.ts --dataset /path/to/frozen-dataset --system-snapshots /path/to/central-snapshots --output /tmp/design-evaluation --workers 1
bun --no-env-file scripts/design-conformance/system-snapshot.ts --repo /path/to/historical.git --dataset /path/to/frozen-dataset --output /tmp/central-snapshots
```

Keep source, catalogue and dataset identities with comparisons. Do not alter historical artifacts or audit labels when maintaining this checker. The integrated full scanner imports the maintained analysis directly. Historical external results stay untouched.

## Reviewed typography

Version 3.8 classifies exact typography sources in the maintained control pass. The full scanner imports the same implementation. `typographyReview` (or `typography-review.json` in full scans) records central references, reviewed Extras, marketing ownership, and unresolved source coverage separately.

- The three existing 400/500/600 weight tokens must be explicitly defined exactly once in the root global theme. Other CSS assignments or JavaScript mentions revoke this bounded reference proof. Missing tokens, changed weights and fallbacks are not approved.
- Eight relative document size recipes require their exact file, unique root selector, ordered declaration list, values and units. Copies, duplicate declarations, nested contexts and altered recipes remain findings. Only the matching font-size warning is classified; other styling remains independently governed.
- ThinkingLoader requires its single literal size writer to multiply immutable component parameters, on the existing output style object, plus the two exact label selectors and the central body-size fallback. Opaque or changed writers and extra literal mentions revoke approval. This is a reviewed scaling relationship, not a variable-name allowance.
- The known MDX/FAQ marketing helpers are excluded by product scope, and their source is not parsed. A product importer receives an unchecked boundary diagnostic until a later product change moves the shared implementation into product ownership.

Component overrides are **not** automatically exempted. Their exact reviewed dispositions belong in the external migration ledger. Unsupported source and dynamic behavior remain diagnostics; classification does not assert complete runtime cascade coverage.

### Proven style-helper returns and class composition

The colour-assignment audit can follow imported, immutable helper functions that return fresh style objects through `if`/conditional branches. It proves property names separately from values: runtime geometry does not imply an unknown colour writer. Function parameters remain unknown; type annotations do not prove their values. Unknown spreads, computed keys, returned aliases, mutations, loops, exceptions, async helpers, cycles and analysis limits retain warnings. Ordinary colour properties exposed by a helper receive token checks as well as custom properties, so replacing a width-only return with a literal or runtime colour cannot silently clear the original uncertainty.

Finite string arrays joined with a literal separator and unshadowed `String.raw` templates can participate in class analysis. Mutated or escaping arrays and opaque join receivers stay unresolved; no helper or variable is approved by its spelling. Changing an imported helper is audited against the complete base/head source graphs even when its consumer is unchanged.

### External layout allowances (maintained analysis)

`control-layout-allowances.ts` reclassifies only source-resolved `component-chrome` class declarations on the canonical EMCN symbols: `ChipModalField` wrapper `flex-1`, `shrink-0`, `min-h-0`, and `ChipModal` literal positive viewport heights up to 100vh (including dvh/svh/lvh). These are external growth/viewport constraints. Internal padding, colours, borders, field direction, descendant selectors, state variants, important declarations, other components/slots, forwarded wrapper styling and arbitrary units remain governed.

The classifier consumes the resolver's canonical symbol/property findings, not the JSX name or a filename allowlist. It removes individual property findings only; unresolved classes, unknown spreads and other analysis diagnostics remain untouched. A known layout class beside an unknown spread is **not** proof that the component's full styling is safe. Adding another declaration still produces its own finding. This is static conformance analysis, not a runtime CSS-cascade or security proof.

Diff JSON exposes `layoutAllowances`; the full scanner emits `layout-allowances.json`. The diff checker and full scanner share the maintained classifier.

## Local product coverage and review output

The local checker and full scanner use `productScope` for browser `app/desktop` screens and workspace desktop settings. Native desktop/build code, API routes, generated tool metadata, landing routes, docs routes and the two known marketing content renderers are excluded. Landing and docs files are not parsed. A product import from excluded landing components or those marketing renderers produces an unchecked boundary diagnostic with the product importer and target. Product styling that uses a `--landing-*` token is a finding even if the token is defined in `globals.css`.

The maintained source analysis follows bounded immutable object lookups, finite branches and fresh style-object helper returns into colour sinks. It inventories runtime `<style>` overrides, CSS in rendered HTML Blobs, local controls, mixed first-party artwork exports, repeated class treatments, stock shadows, local alpha and typography. Monaco theme chrome and syntax colours are excluded as editor-owned presentation, while other product styling in the same file remains checked. Registered block identity metadata is recognized as an intentional per-block colour. Provider and customer data are not treated as authored product colours solely because a string resembles a colour. Dynamic values, ambiguous imports and tracing limits remain explicit uncertainty.

Full scans write `review-items.json`, `coverage-failures.json` and, when `--reviews` is supplied, `review-decisions.json` alongside the existing raw findings and unchecked diagnostics. The scanner and diff checker import the maintained extractor from `scripts/design-conformance/` directly. CI runs the immutable diff check as a warning-only step and uploads the complete JSON report. Findings do not fail that step; missing revisions, failed extraction and incomplete reports do. Full scans and browser captures remain explicit local commands.

## Local Design Studio

`bun run studio:refresh` scans the current working tree and writes the manifest, raw scan and light/dark captures at 16px/20px root size to `~/.local/state/sim2/design-studio` (override with `SIM_STUDIO_OUTPUT`). The Studio lives in `tools/design-studio`, outside the deployed Sim route tree. Run `bun run studio:dev` and open `http://127.0.0.1:3001/components` or `/extras`. Opening a page only reads the latest published run; it does not scan.

Every detected finding and review item appears on Extras even without a review decision. An optional external `SIM_STUDIO_LEDGER=/absolute/path/reviews.json` adds context but never filters entries. EMCN exports and variants come from public source barrels. Existing source-backed fixtures mount real components; other detections receive source-derived indicative samples. Missing fixtures and capture failures stay visible, and an incomplete refresh exits 1. `SIM_STUDIO_CAPTURE_LIMIT` is only for local debugging and deliberately yields an incomplete run.
