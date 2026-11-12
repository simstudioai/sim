# Connect once and control how credentials are used

Edition identity: `manual-saved-credentials-and-access`. Part of the November 11 editorial catch-up through v0.9.54. Published on the review date, not backdated to the source releases. Canonical: https://www.sim.ai/changelog/saved-credentials-and-access.

## Editorial selection

Reviewed the complete commit inventory since v0.9.32 alongside every published stable release through v0.9.54. The four focused stories cover Search/browser work, reusable credentials/access, workflow management, and media creation. Internal refactors, dependency and CI changes, routine validation/retry fixes, and marketing-library edits stay in technical history. People remains gated and its redesign was reverted; scheduled-job runtime without a public creation path is not announced. Provider/model additions do not lead just because they are new. No forced length or category quota.

Each section identifies the actual release carrying its changes. There is no single release URL or reused technical-release RSS identifier; the canonical article URL identifies this edition. The image-to-video story incorporates the unfinished automated November 9 brief without duplicating an existing published article.

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

All listed source merge commits are ancestors of the successfully deployed v0.9.54 production release. Release membership comes from explicit PR references, not timestamps. Current source, deployed documentation, production availability, permission boundaries and relevant provider restrictions were checked. Read-only verification does not establish a new third-party action, paid generation, keyless cloud setup, or workflow execution.

## Media

Original generated editorial illustration, 1672 × 941. Prompt: “Use case: stylized-concept. Create an original editorial illustration for a Sim changelog article about reusable credentials and carefully controlled access. Wide 16:9 composition. A quiet monumental pale concrete gateway with two offset rectangular openings, viewed obliquely across a rocky plateau, distant mountain ridges visible through the opening. Architectural clarity, soft cloudy daylight, painterly graphite and gouache texture, strictly grayscale, restrained mid-gray contrast, fine natural texture. Sophisticated calm landscape like a hand-painted architectural study. No people, no locks or keys as icons, no text, no logos, no interface, no color, no borders. Single complete image.”

This is conceptual art, not product UI or evidence of an execution. Independently verified behavior comes from the source changes and live product/docs.

Final immutable asset: `/changelog/credentials-gateway-v1.jpg`. The shared media frame, radius and lightbox are unchanged. Original files and generation provenance are preserved privately. No credentials, private workspace content, performance claims or generated product controls appear in the asset.

## Review

- [x] Claim/source/release and access review completed.
- [x] Media inspected at its native dimensions.
- [x] Article desktop/mobile layout, links, metadata and discovery checked.
- [x] Required local repository gates completed; local test suites were not run.
- [ ] Both current-head reviews and CI completed.
- [ ] Actual staging deployment and hosted QA completed.

## Announcement draft

Sim workflows can reuse saved credentials instead of repeated keys. Keyless cloud connections and read-only API keys give teams more control. https://www.sim.ai/changelog/saved-credentials-and-access

Distribution remains manual and requires verification of the production article. Staging publication alone does not establish production publication.
