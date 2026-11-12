# Start a video from your own image

Edition identity: `2026-11-09` (the existing scheduled edition, completed during this catch-up). Part of the November 11 editorial catch-up through v0.9.54. Published on the review date, not backdated to the source releases. Canonical: https://www.sim.ai/changelog/video-from-your-image.

## Editorial selection

Reviewed the complete commit inventory since v0.9.32 alongside every published stable release through v0.9.54. The four focused stories cover Search/browser work, reusable credentials/access, workflow management, and media creation. Internal refactors, dependency and CI changes, routine validation/retry fixes, and marketing-library edits stay in technical history. People remains gated and its redesign was reverted; scheduled-job runtime without a public creation path is not announced. Provider/model additions do not lead just because they are new. No forced length or category quota.

Each section identifies the actual release carrying its changes. There is no single release URL or reused technical-release RSS identifier; the canonical article URL identifies this edition. The image-to-video story incorporates the unfinished automated November 9 brief without duplicating an existing published article.

## Sources

| Source | Change reviewed | Published release |
| --- | --- | --- |
| [#9761](https://github.com/simstudioai/sim/pull/9761) | feat(video): accept a start frame image for fal.ai video models | v0.9.48 |
| [#9787](https://github.com/simstudioai/sim/pull/9787) | fix(video): read the active start frame input when serializing video settings | v0.9.48 |
| [#9640](https://github.com/simstudioai/sim/pull/9640) | feat(video): expand the fal text-to-video model catalog | v0.9.43 |
| [#9653](https://github.com/simstudioai/sim/pull/9653) | feat(image-generator): refresh provider model catalogs and validate requests | v0.9.43 |
| [#9756](https://github.com/simstudioai/sim/pull/9756) | feat(media): add Higgsfield to video and image generators, allow typed models | v0.9.47 |
| [#9741](https://github.com/simstudioai/sim/pull/9741) | fix(billing): withhold hosted Fal.ai video generation from free-plan payers | v0.9.45 |

All listed source merge commits are ancestors of the successfully deployed v0.9.54 production release. Release membership comes from explicit PR references, not timestamps. Current source, deployed documentation, production availability, permission boundaries and relevant provider restrictions were checked. Read-only verification does not establish a new third-party action, paid generation, keyless cloud setup, or workflow execution.

## Media

Original generated editorial illustration, 1672 × 941. Prompt: “Use case: stylized-concept. Original editorial illustration for a Sim changelog article about turning a still reference image into a video. Wide 16:9 composition. A quiet coastal inlet with a small sailboat, a broad luminous bank of fog drifting between distant layered mountains and low rocky islands, subtle ripple arcs across still water. Hand-painted graphite and gouache look with delicate paper grain, strictly grayscale, soft silver light, restrained contrast, cinematic wide framing, quiet motion suggested through water and cloud shapes. No words, no logos, no interface, no film frames or equipment, no decorative border. Single complete image.”

This is conceptual art, not product UI or evidence of an execution. Independently verified behavior comes from the source changes and live product/docs.

Final immutable asset: `/changelog/video-still-water-v1.jpg`. The shared media frame, radius and lightbox are unchanged. Original files and generation provenance are preserved privately. No credentials, private workspace content, performance claims or generated product controls appear in the asset.

## Review

- [x] Claim/source/release and access review completed.
- [x] Media inspected at its native dimensions.
- [x] Article desktop/mobile layout, links, metadata and discovery checked.
- [x] Required local repository gates completed; local test suites were not run.
- [ ] Both current-head reviews and CI completed.
- [ ] Actual staging deployment and hosted QA completed.

## Announcement draft

Sim can use your image as the starting frame for supported fal.ai videos, with more image and video model choices in workflow generators. https://www.sim.ai/changelog/video-from-your-image

Distribution remains manual and requires verification of the production article. Staging publication alone does not establish production publication.
