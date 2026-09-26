# Design conformance

Tool/report **4.0.0**, policy **design-conformance/2.0.0**, generated facts **2.0.0**.

The diff check, full scanner and local Studio share the maintained analysis and source-generated contracts. They produce one `findings` list: detected styling and design decisions to review. Findings are warnings in CI. Unresolved inputs stay in `unchecked`; parsing/extraction failures are errors, not a clean check.

## Commands

From the repository root with the pinned Bun installation:

```sh
bun run design:generate
bun run check:design-generated
bun run check:design --base origin/staging --working-tree
bun run check:design --base origin/staging --head HEAD
bun run design:scan --repo . --working-tree --output /tmp/sim-design-scan
bun run studio:refresh
bun run studio:dev
```

Use the actual PR target for `--base`. Working-tree mode includes staged, unstaged and nonignored new files. Immutable mode reads merge-base and head Git blobs independently. Neither mode executes product modules. Local diff/scan exit codes: **0** completed without findings, **1** completed with findings, **2** inspection/operational failure.

Regenerate when EMCN implementation, public API, recipes, ownership metadata or global styles change. Review and commit `contracts.generated.json` alongside the source. `check:design-generated` is read-only and runs through the existing audit runner: missing, tampered, malformed or stale output fails. During editing the diff check derives fresh facts and reports staleness with the regeneration command; it still shows the originating source change after regeneration.

CI uses immutable event base/head revisions. It publishes file/line warnings, a summary and a JSON artifact. Findings do not fail the design step; inability to inspect the changed source does. Infrastructure freshness is a separate required audit. CI does not capture browser previews or commit generated files.

## Files and source facts

- `contracts.json`: general design rules, scope, exclusions, static-analysis limits, adopted utility policy and explicitly central external recipes. It has no component registration or handwritten component inheritance.
- `generated-contracts.ts`: one TypeScript compatibility program per source snapshot discovers public APIs, aliases and compound exports. Babel traces implementation classes, CVA/imported recipes, slots and forwarding. Existing CSS/Tailwind analysis identifies owned properties and global token definitions, contexts and aliases. Bounded caches share the result. Snapshot hosts can read pinned dependency types but cannot read current workspace implementations while inspecting historical source.
- `contracts.generated.json`: compact public export/variant/default/slot/relationship facts, shared recipe references and global token facts. Component and icon namespaces remain distinct. Native HTML prop inventories, usage sites, reports and captures are not included.
- `conformance.ts`, `extract.ts`, `normalize.ts`, `source-summary.ts`, `control-*.ts`: shared styling, composition, control, artwork and provenance analysis. `command.ts` and `reporting.ts` handle local comparisons; `ci.ts` handles warning-only CI publication.
- `scripts/design-scan/`: whole-tree inventory and external reports using that same analysis.
- `scripts/design-studio/refresh.mjs`, `tools/design-studio/`: explicit local refresh and separate local-only Next app. The deployed Sim app has no Studio route.

Each component's supported finite design props come from its public type and its implementation/defaults, rather than every value in an underlying shared recipe. For example Chip does not inherit ChipDropdown-only variants. Styling inputs are separate slots; forwarded chrome is traced to its actual owner. The generator never imports or runs product modules.

Finite nested object lookups retain the selected recipe's properties. Barrel imports resolve to their implementation, and destructured inputs are excluded from rest forwarding. Studio fixture coverage follows each export separately: a family's adapter supports a variant only when that export actually receives the variant props. Nonvisual constants remain in the inventory without preview cards.

## Ownership metadata

Ordinary layout remains local. Consumer changes to component-authored colours, typography, borders, radius, spacing, dimensions or effects are findings, including newly added components without registration. Use a supported component prop/variant first. Deliberate customization or ownership that cannot be inferred belongs in the component's existing TSDoc:

```ts
/**
 * A surface whose shape is chosen by the caller.
 * @designAllow className border-radius dimensions
 * @designAllow style border-radius dimensions
 */
```

`@designProtect <slot> <properties>` adds explicit ownership. Properties are CSS property names or policy groups (`colours`, `typography`, `borders`, `dimensions`, `effects`, `spacing`, `radii`, `visibility`, `layout`); `*` means all properties. Nonexistent slots, malformed tags, invalid properties and contradictory allow/protect declarations fail generation. Permissions do not prove global-token provenance or suppress independent rules. Source and metadata changes remain design-system findings after regeneration.

## Rule contract

| Rule family | Inputs and output | Boundaries |
| --- | --- | --- |
| Central colour/typography/radius/shadow | Visible CSS/class/style inputs traced to EMCN/global definitions; local departures create findings | Equal literal values and repetition do not grant provenance. Ordinary layout is local. |
| Component chrome and composition | Per-slot authored properties, forwarding, class/style overrides and recognizable modal fields | Children/forwarding follows supported source syntax. Unsupported routes remain unchecked. |
| Central definitions | Changes to tokens, recipes, component API/defaults/ownership and policy | Regenerating the artifact cannot hide the source change. Central authoring can intentionally change styling. |
| Local controls/visuals and repeated treatments | Styled native/editor controls, noninteractive primitives, repeated typography/chrome, alpha and status colours | These are review evidence, not proof of visual defects. Pure complete EMCN recipe use does not create a local-control finding. |
| Artwork | Product glyphs and static SVG drawings; central reuse and exact duplicates | Provider branding and user media are exempt. Mixed files are inspected by export/consumer, not broadly exempted. |
| Colour assignments | CSS/custom-property writers, immutable imported aliases, finite branches and supported DOM writes | Missing/literal/non-colour origins warn; dynamic writers, cycles, unknown spreads and runtime inheritance stay unchecked. |
| Control simplifications | Source-proven redundant styling, accessible names and duplicate artwork | Removal proofs require every supported alternative; accessibility is a bounded static check, not a browser audit. |

Scope is product browser UI, including browser `app/desktop` screens and workspace desktop settings. Landing, docs, API routes, native desktop and build code are not inspected. Product imports from excluded landing implementations remain explicit unchecked boundaries. Product `--landing-*` use is a finding even when defined in global CSS.

Monaco theme/syntax presentation, provider branding and every block/trigger catalogue identity palette are deliberately excluded. This does not exempt unrelated product controls in those files. Customer-selected branding and user content are distinguished from authored product colours; unresolved flows remain visible.

Static analysis handles bounded immutable constants/imports, finite alternatives, supported helper returns, JSX/CSS/HTML strings and known runtime overrides. Arbitrary JS, dynamic cascade, unsupported parsers/forwarding and ambiguous data flow cannot be approved. Limits include 2 MiB per source, resolution depth 12 and bounded branch/summary caches. Generator diagnostics preserve unresolved token aliases, cycles and delegated implementation gaps.

## Debt and review records

Diff matching counts occurrences by source treatment and owner. Unchanged debt and line shifts stay quiet; another copy warns. Source-only styling changes are traced to consumers. An unrelated deletion cannot cancel a new occurrence.

Optional `--reviews /absolute/external/reviews.json` attaches source-fingerprint decisions and rationale/evidence. Legacy fingerprints migrate only through a unique current treatment; stale and ambiguous matches require renewed review. Decisions never remove raw findings or control Studio inclusion.

## Studio and evidence

Refresh checks infrastructure freshness, scans the working tree, inventories EMCN public visual exports/variants and all detected Extras, then captures source-backed fixtures or clearly labeled indicative source-style samples. Fixed props/data/providers enable deterministic previews; product modules are only executed by the isolated browser fixture app, never by the analyzer. Missing adapters and failed captures stay visible. Opening Studio reads the latest publication and never starts a scan.

Reports, manifests and browser images live outside the checkout (default Studio output: `~/.local/state/sim2/design-studio`). All four light/dark, 16px/20px combinations are captured with pinned Playwright, viewport, locale, time, fonts and disabled animation. A run publishes atomically, carries source/scanner/fixture/ledger identities and reports incomplete coverage. Review decisions add context only.

## Verification

```sh
bun run test:scripts
bun run type-check:design
bun run type-check:studio
bun run check:design-generated
bun run check:audits
bun run lint:check
```

The real CLI tests use temporary Git repositories to verify public API lifecycle, immutable isolation, stale/tampered output, ownership metadata, source-only changes, working-tree inputs, occurrence matching and intentional exclusions. Generated bytes must reproduce on unchanged source. Full-scan comparison and browser evidence remain external.
