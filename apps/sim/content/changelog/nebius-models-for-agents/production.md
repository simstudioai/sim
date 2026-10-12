# Nebius Token Factory: production record

Status: editorial, feature, and media review completed October 12, 2026. PR #8924 and its production-record follow-up are merged to staging; hosted article, media, links, discovery, and lightbox verification passed. Production publication remains subject to the publication monitor. Only `index.mdx` is rendered on the website.

## Story and evidence

One new model provider is a useful standalone update. The article explains the choice it adds and links to setup; it does not repeat the provider's full model and capability inventory.

- [PR #8759](https://github.com/simstudioai/sim/pull/8759), merge `b4c38dfac7e3a0166d8abcd0d3325d0ca4cf1729`, is included in [v0.9.15](https://github.com/simstudioai/sim/releases/tag/v0.9.15).
- On October 12, 2026, the production Agent block definition returned the Nebius model options, and the [Nebius provider catalog](https://www.sim.ai/models/nebius) returned successfully. The article uses the provider catalog rather than a model page for a different provider.
- Nebius requires a customer-provided API key. Cloud workspace admins configure it in Workspace settings → BYOK → Nebius; self-hosted users supply it in the Agent block. There is no Nebius-specific plan restriction in the provider or BYOK settings. Model-specific features vary.
- The source PR records live API acceptance of the model catalog and adapter behavior. This publication adds no new model-execution claim or benchmark.
- The [Agent guide](https://docs.sim.ai/workflows/blocks/agent) gains a focused Nebius setup section in this PR. Its `#nebius-token-factory` anchor was checked in the rendered docs preview. The article links to the existing guide without the new anchor, so it remains a working destination while the site and docs deploy independently.

## Media provenance

Captured October 12, 2026, in the running self-hosted app from this PR's staging base. A disposable demo workspace uses a synthetic support-ticket prompt. Open the Agent block, search for `nebius` in Model, and inspect the actual options. The reviewed crop includes the Model label, search field, and model list.

Asset: `/changelog/nebius-model-picker-v1.jpg`, 510 × 268 pixels. Direct browser capture, cropped to the relevant panel; no controls or results were generated or altered. The image is displayed at its captured width on desktop to avoid enlarging small interface text. It opens in the existing shared image lightbox.

A still makes the new model choice easier to inspect than a setup video. No credential entry, saved placeholder key, or execution result is depicted. Availability is established separately above. These production notes are not public article copy.

## Completed publication review

Release editor and feature verification: Codex, under Waleed's delegated review for this PR. Reviewed October 12, 2026:

- Article and announcement copy checked against the released provider and production model options; availability, customer-provided key requirement, and contextual links confirmed.
- Real capture inspected with sample data. No fabricated credential acceptance or execution result; no public capture disclaimers or caption.
- Article and shared lightbox checked at 1280px and a real 390px viewport: no horizontal overflow; image loading, zoom, dismissal, and focus return passed.
- Nebius catalog returned 200. The new setup section and anchor rendered correctly in the docs preview; the article uses the existing guide URL to accommodate independent deployments.
- Content audit passed. Local public article, index, archive, RSS, and sitemap included the entry with the correct canonical URL and media. No local test suites were run; repository checks run in CI.

The reviewed entry is marked `draft: false` for the approved site deployment. CI and code-review results belong in the publication PR. After deployment, verify the hosted article, image, index, archive, RSS, and sitemap. Keep the edition pending until the production canonical URL passes the publication monitor; a staging deployment is not production publication.

Canonical URL: https://www.sim.ai/changelog/nebius-models-for-agents

## Announcement drafts

Social:

> Use DeepSeek, Kimi, Qwen, and other open models through Nebius Token Factory in Sim. Bring your Nebius API key and choose a model in the Agent block. Setup and preview: https://www.sim.ai/changelog/nebius-models-for-agents

Email subject: Use Nebius Token Factory models in your agents

Email body:

> Nebius Token Factory is available in Sim's Agent block. Choose from open models including DeepSeek, Kimi, and Qwen, and use them with your existing prompts and connected tools. Bring your own Nebius API key to get started: https://www.sim.ai/changelog/nebius-models-for-agents

These are drafts. Distribute only after the production article and media are verified.

## Editorial revision

Revised October 12, 2026, to clarify supported behavior and include selected changes from the same technical release where useful. Every public sentence describes a capability, a meaningful change, or necessary access information. Original dates, release references, RSS identities, and reviewed media are preserved. The `updated` timestamp records the substantive revision. Browser and CI evidence belongs in the revision PR.
