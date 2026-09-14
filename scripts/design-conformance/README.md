# Design conformance check

Tool **3.3.1**, policy **design-conformance/1.3.0**. This is the maintained implementation of Sim's design guardrails.

From the repository root, using Bun **1.4.1** and the normal root installation:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check:design --base origin/staging --head HEAD
bun run check:design --base origin/staging --format json --output /tmp/design-report.json
```

Use the actual PR target for `--base`; it is required. The repository defaults to this checkout, and the head defaults to `HEAD`. `--repo` accepts another complete Git checkout. Only committed merge-base → head changes are inspected; staged and uncommitted edits are not included. No application build, application/configuration/plugin execution, AI, network review or automatic fixes occur.

## Results and CI

- **Usage violations** identify newly introduced inputs that violate an explicit central design contract, the authoritative definition, and the permitted token/component mechanism. Fix confirmed violations through that mechanism.
- **System changes** identify edits to central definitions or this registry. Review them as changes to the design system; central authoring may introduce new styling.
- **Unchecked inputs** describe unresolved syntax or coverage limits. They do not create findings, and a clean result does not prove exhaustive conformance. Text output identifies incomplete coverage and lists every diagnostic with its file, line, comparison side, context and reason. The CI summary includes an expandable list of the first 100 diagnostics, with long entries shortened; complete details remain in the check log and JSON report.

The ordinary command exits **0** for no findings, **1** for findings and **2** for operational failure. JSON retains `flagged: true` even during the warning-only rollout; failed reports have `flagged: null`.

The dedicated CI step emits warning annotations and a job summary for both finding types. It accepts exit 1 only alongside a fresh completed report proving that findings exist. Missing refs, missing central inputs, startup errors, signals and output failures still fail CI. It uses immutable PR base/head SHAs or the entire push's before/after SHAs, with full Git history. Manual runs and new branches use the previous commit as their fallback base. There is no automatic transition to blocking findings, no PR-comment bot and no local hook installation.

## Policy and maintenance

`contracts.json` records governing rules, central guidance, component ownership and supported composition. Colours and typography require central provenance; radii/shadows are governed where central families exist. Approved building blocks may be combined freely. Other geometry and layout remain unrestricted unless an explicit component/slot rule applies. Documented branding inputs and artwork exclusions remain supported.

The checker reads the fixed central inventory at the immutable merge-base, then overlays proposed central definitions for their consumers. It does not infer approval from application repetition or equal literal values. Unchanged debt stays quiet; new copies remain eligible. Moving noncompliant inputs to another file or component, including supported extraction and Git renames, now notifies. Wording-only edits and unchanged authored inputs within the same owner remain quiet. Both the legacy and integrated registry locations are recognized as central-system changes.

Extraction remains bounded to changed modules plus the fixed central inventory. Unknown helpers/imports, unsupported control flow, complex dynamic recipes and runtime cascade/inheritance remain unchecked. Source limit: 2 MiB; resolution depth: 12; additional summary metadata: 32 MiB. Other bounded caches and exclusions remain encoded in the registry and implementation. Central selector repairs and Tailwind source-scanning changes notify even when they restore intended styles. Frozen historical comparisons are development data, not measured unseen accuracy.

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

## Artwork, scope and agent judgment

The registry declares central artwork libraries: EMCN `icons/`, EMCN `illustrations/` (available for new assets), and the shared `apps/sim/components/iso/` library. Reuse is quiet; added, changed and removed assets notify as system changes. Source assets are parsed without execution and formatting/comments are normalized. CSS, SVG files and raster assets use Git blob identity; even a metadata-only asset edit can warn. Their blob identities appear in evidence; asset definitions are separate from the historical colour/theme snapshot because they do not authorize consumer styling values.

New or changed local JSX SVG drawings notify as artwork ownership violations. Visible SVG chart text retains ordinary typography checks. User-uploaded media, provider branding inputs and ordinary media content remain exempt. `brandAssets` explicitly records sanctioned third-party glyphs, including their direct barrel exports; arbitrary component names or comments never create this exemption. The legacy mixed `apps/sim/components/icons.tsx` file remains explicitly excluded with an unchecked diagnostic; separating provider logos from product icons is a follow-up ownership task. Artwork expressions are compared as authored syntax; changes solely inside an opaque helper or an unchanged local reference may remain unchecked. Arbitrary HTML/CSS illustrations are not guessed from names or `aria-hidden`; normal governed styling rules still apply. Use central libraries for future product artwork, with the designer owning the shared asset rather than every internal coordinate. This release does not relocate or retroactively approve all existing artwork, and does not enforce a universal icon size.

Landing routes remain excluded. `ownership` in the reviewed registry can declare landing-only source outside those routes, with its governing owner and reason. The consent preferences trigger is declared there because both callers belong to landing pages. Product reuse must remove that declaration; the checker does not build a repository-wide caller graph. Registry changes themselves notify, so scope declarations are reviewable.

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

Keep source, catalogue and dataset identities with comparisons. Do not alter historical artifacts or audit labels when maintaining this checker. The standalone experiment is archived; future implementation changes belong here.
