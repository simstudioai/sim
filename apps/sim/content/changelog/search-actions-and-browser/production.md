# Find answers and take action without leaving Search

Edition identity: `manual-search-actions-and-browser`. Part of the November 11 editorial catch-up through v0.9.54. Published on the review date, not backdated to the source releases. Canonical: https://www.sim.ai/changelog/search-actions-and-browser.

## Editorial selection

Reviewed the complete commit inventory since v0.9.32 alongside every published stable release through v0.9.54. The four focused stories cover Search/browser work, reusable credentials/access, workflow management, and media creation. Internal refactors, dependency and CI changes, routine validation/retry fixes, and marketing-library edits stay in technical history. People remains gated and its redesign was reverted; scheduled-job runtime without a public creation path is not announced. Provider/model additions do not lead just because they are new. No forced length or category quota.

Each section identifies the actual release carrying its changes. There is no single release URL or reused technical-release RSS identifier; the canonical article URL identifies this edition. The image-to-video story incorporates the unfinished automated November 9 brief without duplicating an existing published article.

## Sources

| Source | Change reviewed | Published release |
| --- | --- | --- |
| [#9428](https://github.com/simstudioai/sim/pull/9428) | feat(search): unify organization search and reviewed assistant actions | v0.9.37 |
| [#9451](https://github.com/simstudioai/sim/pull/9451) | fix(search): inline action review and unify account menus | v0.9.37 |
| [#9454](https://github.com/simstudioai/sim/pull/9454) | feat(extension): bring Sim chat and page context to Chrome | v0.9.37 |
| [#9515](https://github.com/simstudioai/sim/pull/9515) | feat(desktop): continue a passkey sign-in in your browser and bring the session back | v0.9.39 |
| [#9647](https://github.com/simstudioai/sim/pull/9647) | improvement(search): cite public web results like connected sources in Search Assistant | v0.9.43 |
| [#9683](https://github.com/simstudioai/sim/pull/9683) | improvement(extension): simplify page access and enable voice input | v0.9.44 |
| [#9689](https://github.com/simstudioai/sim/pull/9689) | improvement(extension): allow more pages within a shared content budget | v0.9.44 |
| [#9698](https://github.com/simstudioai/sim/pull/9698) | improvement(links): make go/ and sim/ work with no setup | v0.9.44 |
| [#9716](https://github.com/simstudioai/sim/pull/9716) | feat(search): connect multiple accounts per integration | v0.9.45 |

All listed source merge commits are ancestors of the successfully deployed v0.9.54 production release. Release membership comes from explicit PR references, not timestamps. Current source, deployed documentation, production availability, permission boundaries and relevant provider restrictions were checked. Read-only verification does not establish a new third-party action, paid generation, keyless cloud setup, or workflow execution.

## Media

Existing real product capture from the Search action-review documentation introduced with #9428, using sample data. Reused from `apps/docs/public/static/search/assistant-action-review.png`, 1440 × 1000, with aspect ratio preserved. It shows review proposals, not successful Jira delivery. The original feature QA used controlled provider transports; no new provider write was performed for this article.

Final immutable asset: `/changelog/search-action-review-v1.jpg`. The shared media frame, radius and lightbox are unchanged. Original files and generation provenance are preserved privately. No credentials, private workspace content, performance claims or generated product controls appear in the asset.

## Review

- [x] Claim/source/release and access review completed.
- [x] Media inspected at its native dimensions.
- [x] Article desktop/mobile layout, links, metadata and discovery checked.
- [x] Required local repository gates completed; local test suites were not run.
- [ ] Both current-head reviews and CI completed.
- [ ] Actual staging deployment and hosted QA completed.

## Announcement draft

Sim Search can turn findings into reviewed actions. Connect more accounts, ask about pages in Chrome, and open shared team shortcuts. https://www.sim.ai/changelog/search-actions-and-browser

Distribution remains manual and requires verification of the production article. Staging publication alone does not establish production publication.
