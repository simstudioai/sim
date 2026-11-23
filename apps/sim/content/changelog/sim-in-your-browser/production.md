# Ask Sim about the page you’re reading

Edition identity: `manual-sim-in-your-browser`. Canonical: https://www.sim.ai/changelog/sim-in-your-browser.

## Date and scope

Retrospective edition dated 2026-11-04, using the Pacific calendar day of the release anchoring this story. This is an editorial date for the catch-up, not a claim that this article was already public then. The updated timestamp records the current review; later additions name their actual release. Browser coverage is anchored to the expanded v0.9.44 experience. Existing published article dates and RSS identities remain unchanged.

Reviewed the complete change inventory since v0.9.32 through v0.9.54, then inspected substantive candidates and their released behavior. Five focused stories cover Search, browser/desktop work, credentials/access, workflow management, and media creation. Short supporting notes explain practical changes. The editorial reference was Gumloop’s direct headlines and compact grouped improvements; no competitor claims or copy were reused.

Routine maintenance, refactors, dependency/CI work and marketing-library posts remain in technical history. Files pagination preserves existing search/filter capabilities and has no measured speed claim, so it is not presented as a new feature. People remains gated/reverted; scheduled-job runtime has no public creation path; Marketplace rollout was not established. Model and integration counts do not displace stronger stories. No forced padding.

## Sources

| Source | Change reviewed | Published release |
| --- | --- | --- |
| [#9454](https://github.com/simstudioai/sim/pull/9454) | feat(extension): bring Sim chat and page context to Chrome | v0.9.37 |
| [#9515](https://github.com/simstudioai/sim/pull/9515) | feat(desktop): continue a passkey sign-in in your browser and bring the session back | v0.9.39 |
| [#9512](https://github.com/simstudioai/sim/pull/9512) | improvement(desktop): bring agent browser menus, keys and fullscreen in line with Chrome | v0.9.39 |
| [#9505](https://github.com/simstudioai/sim/pull/9505) | improvement(desktop): install updates on one click, asking only about real in-flight work | v0.9.39 |
| [#9533](https://github.com/simstudioai/sim/pull/9533) | fix(desktop): ask before an update restart from the menu, count uploads and downloads as running work, and harden sign-in prompts | v0.9.39 |
| [#9547](https://github.com/simstudioai/sim/pull/9547) | fix(desktop): address release review — count app downloads and unchecked terminals before an update restart, send the page referrer on Save Image, and tighten sign-in and people edge cases | v0.9.39 |
| [#9683](https://github.com/simstudioai/sim/pull/9683) | improvement(extension): simplify page access and enable voice input | v0.9.44 |
| [#9689](https://github.com/simstudioai/sim/pull/9689) | improvement(extension): allow more pages within a shared content budget | v0.9.44 |
| [#9698](https://github.com/simstudioai/sim/pull/9698) | improvement(links): make go/ and sim/ work with no setup | v0.9.44 |

Release membership uses explicit PR references. Every listed merge commit is an ancestor of the successfully deployed v0.9.54 production release. Current code, live documentation, availability and access restrictions were reviewed. No new provider write, paid generation, keyless cloud setup or workflow execution is claimed. The canonical article URL supplies a new RSS GUID; no technical-release GUID is reused.

## Media

Original generated editorial illustration of an open stone observatory and mountain valley, 1672 × 941. Built-in image generation; no product UI, text, logos or invented results. The artwork expresses taking a workspace beyond a window and does not prove extension or desktop behavior. The full prompt and original output are retained with the art provenance. Final asset: `/changelog/browser-open-window-v1.jpg`. Shared media frame and lightbox unchanged.

## Review

- [x] Claim/source/release and access review completed.
- [x] Media inspected at native dimensions.
- [x] Revised article desktop/mobile layout, links, metadata and discovery checked.
- [x] Required local repository gates completed; test suites are left to CI.
- [ ] Both current-head reviews and CI completed.
- [ ] Actual staging deployment and hosted QA completed.

## Announcement draft

Bring pages and selected passages into Sim from Chrome. Add context from several tabs, dictate a draft, and open your team’s shared shortcuts. https://www.sim.ai/changelog/sim-in-your-browser

Distribution remains manual and requires verification of the production article. Staging publication alone does not establish production publication.
