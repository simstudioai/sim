# Connect once and control how credentials are used

Edition identity: `manual-saved-credentials-and-access`. Canonical: https://www.sim.ai/changelog/saved-credentials-and-access.

## Date and scope

Retrospective edition dated 2026-11-10, using the Pacific calendar day of the release anchoring this story. This is an editorial date for the catch-up, not a claim that this article was already public then. The updated timestamp records the current review; later additions name their actual release. Browser coverage is anchored to the expanded v0.9.44 experience. Existing published article dates and RSS identities remain unchanged.

Reviewed the complete change inventory since v0.9.32 through v0.9.54, then inspected substantive candidates and their released behavior. Five focused stories cover Search, browser/desktop work, credentials/access, workflow management, and media creation. Short supporting notes explain practical changes. The editorial reference was Gumloop’s direct headlines and compact grouped improvements; no competitor claims or copy were reused.

Routine maintenance, refactors, dependency/CI work and marketing-library posts remain in technical history. Files pagination preserves existing search/filter capabilities and has no measured speed claim, so it is not presented as a new feature. People remains gated/reverted; scheduled-job runtime has no public creation path; Marketplace rollout was not established. Model and integration counts do not displace stronger stories. No forced padding.

## Sources

| Source | Change reviewed | Published release |
| --- | --- | --- |
| [#9763](https://github.com/simstudioai/sim/pull/9763) | feat(credentials): saved credentials and credential-only block versions, with keyless AWS/Databricks OIDC | v0.9.53 |
| [#9840](https://github.com/simstudioai/sim/pull/9840) | feat(credentials): saved credentials for 17 more blocks, GitLab tokens, and keyless hardening | v0.9.53 |
| [#9849](https://github.com/simstudioai/sim/pull/9849) | feat(credentials): saved credentials for 21 token-and-host blocks on one host-aware check factory | v0.9.53 |
| [#9869](https://github.com/simstudioai/sim/pull/9869) | feat(credentials): keyless Snowflake, Microsoft app-only and Google keyless, GitHub and Bitbucket tokens, DocuSign JWT | v0.9.53 |
| [#9875](https://github.com/simstudioai/sim/pull/9875) | feat(credentials): set up keyless credentials from the v2 API, CLI and Sim MCP | v0.9.53 |
| [#9855](https://github.com/simstudioai/sim/pull/9855) | feat(api-keys): read-only API keys and expiry at creation | v0.9.53 |
| [#9879](https://github.com/simstudioai/sim/pull/9879) | chore(api-keys): remove the api-key-read-only flag | v0.9.54 |
| [#9911](https://github.com/simstudioai/sim/pull/9911) | feat(credentials): audit fixes and non-OAuth auth for CrowdStrike, Datadog, Gong, PlanetScale, SailPoint, ServiceNow, Zendesk, ZoomInfo, Shopify, Atlassian, Linear and Twilio | v0.9.54 |

Release membership uses explicit PR references. Every listed merge commit is an ancestor of the successfully deployed v0.9.54 production release. Current code, live documentation, availability and access restrictions were reviewed. No new provider write, paid generation, keyless cloud setup or workflow execution is claimed. The canonical article URL supplies a new RSS GUID; no technical-release GUID is reused.

## Media

Original generated editorial illustration, 1672 × 941. Prompt: “Use case: stylized-concept. Create an original editorial illustration for a Sim changelog article about reusable credentials and carefully controlled access. Wide 16:9 composition. A quiet monumental pale concrete gateway with two offset rectangular openings, viewed obliquely across a rocky plateau, distant mountain ridges visible through the opening. Architectural clarity, soft cloudy daylight, painterly graphite and gouache texture, strictly grayscale, restrained mid-gray contrast, fine natural texture. Sophisticated calm landscape like a hand-painted architectural study. No people, no locks or keys as icons, no text, no logos, no interface, no color, no borders. Single complete image.”

This is conceptual art, not product UI or evidence of an execution. Independently verified behavior comes from the source changes and live product/docs.

Final immutable asset: `/changelog/credentials-gateway-v1.jpg`. The shared media frame, radius and lightbox are unchanged. Original files and generation provenance are preserved privately. No credentials, private workspace content, performance claims or generated product controls appear in the asset.

## Review

- [x] Claim/source/release and access review completed.
- [x] Media inspected at native dimensions.
- [x] Revised article desktop/mobile layout, links, metadata and discovery checked.
- [x] Required local repository gates completed; test suites are left to CI.
- [ ] Both current-head reviews and CI completed.
- [ ] Actual staging deployment and hosted QA completed.

## Announcement draft

Sim workflows can reuse saved credentials instead of repeated keys. Keyless cloud connections and read-only API keys give teams more control. https://www.sim.ai/changelog/saved-credentials-and-access

Distribution remains manual and requires verification of the production article. Staging publication alone does not establish production publication.
