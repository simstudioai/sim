# Start a video from your own image

Edition identity: `2026-11-09`. Canonical: https://www.sim.ai/changelog/video-from-your-image.

## Date and scope

Retrospective edition dated 2026-11-07, using the Pacific calendar day of the release anchoring this story. This is an editorial date for the catch-up, not a claim that this article was already public then. The updated timestamp records the current review; later additions name their actual release. Browser coverage is anchored to the expanded v0.9.44 experience. Existing published article dates and RSS identities remain unchanged.

Reviewed the complete change inventory since v0.9.32 through v0.9.54, then inspected substantive candidates and their released behavior. Five focused stories cover Search, browser/desktop work, credentials/access, workflow management, and media creation. Short supporting notes explain practical changes. The editorial reference was Gumloop’s direct headlines and compact grouped improvements; no competitor claims or copy were reused.

Routine maintenance, refactors, dependency/CI work and marketing-library posts remain in technical history. Files pagination preserves existing search/filter capabilities and has no measured speed claim, so it is not presented as a new feature. People remains gated/reverted; scheduled-job runtime has no public creation path; Marketplace rollout was not established. Model and integration counts do not displace stronger stories. No forced padding.

## Sources

| Source | Change reviewed | Published release |
| --- | --- | --- |
| [#9761](https://github.com/simstudioai/sim/pull/9761) | feat(video): accept a start frame image for fal.ai video models | v0.9.48 |
| [#9787](https://github.com/simstudioai/sim/pull/9787) | fix(video): read the active start frame input when serializing video settings | v0.9.48 |
| [#9640](https://github.com/simstudioai/sim/pull/9640) | feat(video): expand the fal text-to-video model catalog | v0.9.43 |
| [#9653](https://github.com/simstudioai/sim/pull/9653) | feat(image-generator): refresh provider model catalogs and validate requests | v0.9.43 |
| [#9756](https://github.com/simstudioai/sim/pull/9756) | feat(media): add Higgsfield to video and image generators, allow typed models | v0.9.47 |
| [#9741](https://github.com/simstudioai/sim/pull/9741) | fix(billing): withhold hosted Fal.ai video generation from free-plan payers | v0.9.45 |

Release membership uses explicit PR references. Every listed merge commit is an ancestor of the successfully deployed v0.9.54 production release. Current code, live documentation, availability and access restrictions were reviewed. No new provider write, paid generation, keyless cloud setup or workflow execution is claimed. The canonical article URL supplies a new RSS GUID; no technical-release GUID is reused.

## Media

Original generated editorial illustration, 1672 × 941. Prompt: “Use case: stylized-concept. Original editorial illustration for a Sim changelog article about turning a still reference image into a video. Wide 16:9 composition. A quiet coastal inlet with a small sailboat, a broad luminous bank of fog drifting between distant layered mountains and low rocky islands, subtle ripple arcs across still water. Hand-painted graphite and gouache look with delicate paper grain, strictly grayscale, soft silver light, restrained contrast, cinematic wide framing, quiet motion suggested through water and cloud shapes. No words, no logos, no interface, no film frames or equipment, no decorative border. Single complete image.”

This is conceptual art, not product UI or evidence of an execution. Independently verified behavior comes from the source changes and live product/docs.

Final immutable asset: `/changelog/video-still-water-v1.jpg`. The shared media frame, radius and lightbox are unchanged. Original files and generation provenance are preserved privately. No credentials, private workspace content, performance claims or generated product controls appear in the asset.

## Review

- [x] Claim/source/release and access review completed.
- [x] Media inspected at native dimensions.
- [x] Revised article desktop/mobile layout, links, metadata and discovery checked.
- [x] Required local repository gates completed; test suites are left to CI.
- [ ] Both current-head reviews and CI completed.
- [ ] Actual staging deployment and hosted QA completed.

## Announcement draft

Sim can use your image as the starting frame for supported fal.ai videos, with more image and video model choices in workflow generators. https://www.sim.ai/changelog/video-from-your-image

Distribution remains manual and requires verification of the production article. Staging publication alone does not establish production publication.
