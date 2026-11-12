# See which workflows need your attention

Edition identity: `manual-workflow-run-controls`. Part of the November 11 editorial catch-up through v0.9.54. Published on the review date, not backdated to the source releases. Canonical: https://www.sim.ai/changelog/workflow-run-controls.

## Editorial selection

Reviewed the complete commit inventory since v0.9.32 alongside every published stable release through v0.9.54. The four focused stories cover Search/browser work, reusable credentials/access, workflow management, and media creation. Internal refactors, dependency and CI changes, routine validation/retry fixes, and marketing-library edits stay in technical history. People remains gated and its redesign was reverted; scheduled-job runtime without a public creation path is not announced. Provider/model additions do not lead just because they are new. No forced length or category quota.

Each section identifies the actual release carrying its changes. There is no single release URL or reused technical-release RSS identifier; the canonical article URL identifies this edition. The image-to-video story incorporates the unfinished automated November 9 brief without duplicating an existing published article.

## Sources

| Source | Change reviewed | Published release |
| --- | --- | --- |
| [#9854](https://github.com/simstudioai/sim/pull/9854) | feat(api): run a pinned deployment version and expose paused run points in v2 | v0.9.53 |
| [#9853](https://github.com/simstudioai/sim/pull/9853) | feat(api): workflow trigger health and enablement through the v2 API | v0.9.53 |
| [#9905](https://github.com/simstudioai/sim/pull/9905) | feat(api): workflow outline, workspace schedules list, clearer v2 errors, and catalog value types | v0.9.54 |
| [#9906](https://github.com/simstudioai/sim/pull/9906) | feat(api): failing block on polled runs, deployed input schema, paused-runs list, and applied limits | v0.9.54 |
| [#9856](https://github.com/simstudioai/sim/pull/9856) | feat(mistral): extract PDF images as files and expose table format in Mistral Parser | v0.9.53 |
| [#9872](https://github.com/simstudioai/sim/pull/9872) | fix(mistral): say V3 parses an uploaded or referenced PDF, and bound Max Images at 100 | v0.9.53 |
| [#9754](https://github.com/simstudioai/sim/pull/9754) | fix(tables): keep leading-zero codes as text when inferring CSV column types | v0.9.47 |
| [#9848](https://github.com/simstudioai/sim/pull/9848) | chore(sdk): remove the TypeScript and Python SDKs | v0.9.53 |
| [#9830](https://github.com/simstudioai/sim/pull/9830) | fix(cli): bind sim-setup's containers to loopback, fix reset and env quoting, retire the legacy simstudio CLI | v0.9.53 |

All listed source merge commits are ancestors of the successfully deployed v0.9.54 production release. Release membership comes from explicit PR references, not timestamps. Current source, deployed documentation, production availability, permission boundaries and relevant provider restrictions were checked. Read-only verification does not establish a new third-party action, paid generation, keyless cloud setup, or workflow execution.

## Media

Original generated editorial illustration, 1672 × 941. Prompt: “Use case: stylized-concept. Original editorial illustration for a Sim changelog article about choosing workflow versions and seeing work waiting for review. Wide 16:9 composition, aerial view of a mountain valley with a thin winding road splitting briefly into two routes around a central rocky ridge and joining again in the distance. Delicate painterly graphite/gouache texture, strict monochrome grayscale, soft overcast light, broad natural shapes, atmospheric depth, understated detail. Calm and spacious, polished landscape painting, no text, labels, diagrams, interface, people, logos, or colorful accents. Single complete image.”

This is conceptual art, not product UI or evidence of an execution. Independently verified behavior comes from the source changes and live product/docs.

Final immutable asset: `/changelog/workflow-paths-v1.jpg`. The shared media frame, radius and lightbox are unchanged. Original files and generation provenance are preserved privately. No credentials, private workspace content, performance claims or generated product controls appear in the asset.

## Review

- [x] Claim/source/release and access review completed.
- [x] Media inspected at its native dimensions.
- [x] Article desktop/mobile layout, links, metadata and discovery checked.
- [x] Required local repository gates completed; local test suites were not run.
- [ ] Both current-head reviews and CI completed.
- [ ] Actual staging deployment and hosted QA completed.

## Announcement draft

Sim makes paused runs and schedules easier to inspect from the CLI or API, and lets you run an earlier deployed version without changing the active one. https://www.sim.ai/changelog/workflow-run-controls

Distribution remains manual and requires verification of the production article. Staging publication alone does not establish production publication.
