# See which workflows need your attention

Edition identity: `manual-workflow-run-controls`. Canonical: https://www.sim.ai/changelog/workflow-run-controls.

## Date and scope

Retrospective edition dated 2026-11-11, using the Pacific calendar day of the release anchoring this story. This is an editorial date for the catch-up, not a claim that this article was already public then. The updated timestamp records the current review; later additions name their actual release. Browser coverage is anchored to the expanded v0.9.44 experience. Existing published article dates and RSS identities remain unchanged.

Reviewed the complete change inventory since v0.9.32 through v0.9.54, then inspected substantive candidates and their released behavior. Five focused stories cover Search, browser/desktop work, credentials/access, workflow management, and media creation. Short supporting notes explain practical changes. The editorial reference was Gumloop’s direct headlines and compact grouped improvements; no competitor claims or copy were reused.

Routine maintenance, refactors, dependency/CI work and marketing-library posts remain in technical history. Files pagination preserves existing search/filter capabilities and has no measured speed claim, so it is not presented as a new feature. People remains gated/reverted; scheduled-job runtime has no public creation path; Marketplace rollout was not established. Model and integration counts do not displace stronger stories. No forced padding.

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
| [#9464](https://github.com/simstudioai/sim/pull/9464) | feat(workflows): let a synchronous run continue in the background after a wait timeout | v0.9.37 |

Release membership uses explicit PR references. Every listed merge commit is an ancestor of the successfully deployed v0.9.54 production release. Current code, live documentation, availability and access restrictions were reviewed. No new provider write, paid generation, keyless cloud setup or workflow execution is claimed. The canonical article URL supplies a new RSS GUID; no technical-release GUID is reused.

## Media

Original generated editorial illustration, 1672 × 941. Prompt: “Use case: stylized-concept. Original editorial illustration for a Sim changelog article about choosing workflow versions and seeing work waiting for review. Wide 16:9 composition, aerial view of a mountain valley with a thin winding road splitting briefly into two routes around a central rocky ridge and joining again in the distance. Delicate painterly graphite/gouache texture, strict monochrome grayscale, soft overcast light, broad natural shapes, atmospheric depth, understated detail. Calm and spacious, polished landscape painting, no text, labels, diagrams, interface, people, logos, or colorful accents. Single complete image.”

This is conceptual art, not product UI or evidence of an execution. Independently verified behavior comes from the source changes and live product/docs.

Final immutable asset: `/changelog/workflow-paths-v1.jpg`. The shared media frame, radius and lightbox are unchanged. Original files and generation provenance are preserved privately. No credentials, private workspace content, performance claims or generated product controls appear in the asset.

## Review

- [x] Claim/source/release and access review completed.
- [x] Media inspected at native dimensions.
- [x] Revised article desktop/mobile layout, links, metadata and discovery checked.
- [x] Required local repository gates completed; test suites are left to CI.
- [ ] Both current-head reviews and CI completed.
- [ ] Actual staging deployment and hosted QA completed.

## Announcement draft

Sim makes paused runs and schedules easier to inspect from the CLI or API, and lets you run an earlier deployed version without changing the active one. https://www.sim.ai/changelog/workflow-run-controls

Distribution remains manual and requires verification of the production article. Staging publication alone does not establish production publication.
