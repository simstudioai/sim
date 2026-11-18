# Find answers and take action without leaving Search

Edition identity: `manual-search-actions-and-browser`. Canonical: https://www.sim.ai/changelog/search-actions-and-browser.

## Date and scope

Retrospective edition dated 2026-10-30, using the Pacific calendar day of the release anchoring this story. This is an editorial date for the catch-up, not a claim that this article was already public then. The updated timestamp records the current review; later additions name their actual release. Browser coverage is anchored to the expanded v0.9.44 experience. Existing published article dates and RSS identities remain unchanged.

Reviewed the complete change inventory since v0.9.32 through v0.9.54, then inspected substantive candidates and their released behavior. Five focused stories cover Search, browser/desktop work, credentials/access, workflow management, and media creation. Short supporting notes explain practical changes. The editorial reference was Gumloop’s direct headlines and compact grouped improvements; no competitor claims or copy were reused.

Routine maintenance, refactors, dependency/CI work and marketing-library posts remain in technical history. Files pagination preserves existing search/filter capabilities and has no measured speed claim, so it is not presented as a new feature. People remains gated/reverted; scheduled-job runtime has no public creation path; Marketplace rollout was not established. Model and integration counts do not displace stronger stories. No forced padding.

## Sources

| Source | Change reviewed | Published release |
| --- | --- | --- |
| [#9428](https://github.com/simstudioai/sim/pull/9428) | feat(search): unify organization search and reviewed assistant actions | v0.9.37 |
| [#9451](https://github.com/simstudioai/sim/pull/9451) | fix(search): inline action review and unify account menus | v0.9.37 |
| [#9647](https://github.com/simstudioai/sim/pull/9647) | improvement(search): cite public web results like connected sources in Search Assistant | v0.9.43 |
| [#9648](https://github.com/simstudioai/sim/pull/9648) | feat(sim-links): create or copy a Sim link from search results and file shares | v0.9.43 |
| [#9716](https://github.com/simstudioai/sim/pull/9716) | feat(search): connect multiple accounts per integration | v0.9.45 |

Release membership uses explicit PR references. Every listed merge commit is an ancestor of the successfully deployed v0.9.54 production release. Current code, live documentation, availability and access restrictions were reviewed. No new provider write, paid generation, keyless cloud setup or workflow execution is claimed. The canonical article URL supplies a new RSS GUID; no technical-release GUID is reused.

## Media

Existing real product capture from the Search action-review documentation introduced with #9428, using sample data. Reused from `apps/docs/public/static/search/assistant-action-review.png`, 1440 × 1000, with aspect ratio preserved. It shows review proposals, not successful Jira delivery. The original feature QA used controlled provider transports; no new provider write was performed for this article.

Final immutable asset: `/changelog/search-action-review-v1.jpg`. The shared media frame, radius and lightbox are unchanged. Original files and generation provenance are preserved privately. No credentials, private workspace content, performance claims or generated product controls appear in the asset.

## Review

- [x] Claim/source/release and access review completed.
- [x] Media inspected at native dimensions.
- [x] Revised article desktop/mobile layout, links, metadata and discovery checked.
- [x] Required local repository gates completed; test suites are left to CI.
- [ ] Both current-head reviews and CI completed.
- [ ] Actual staging deployment and hosted QA completed.

## Announcement draft

Sim Search turns findings into reviewed actions. Connect multiple accounts, cite web sources, and share useful destinations with short team links. https://www.sim.ai/changelog/search-actions-and-browser

Distribution remains manual and requires verification of the production article. Staging publication alone does not establish production publication.
