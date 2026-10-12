# Nebius Token Factory: production record

Status: prepared for publication review. Only `index.mdx` is rendered on the website.

## Story and evidence

One new model provider is a useful standalone update. The article explains the choice it adds and links to setup; it does not repeat the provider's full model and capability inventory.

- [PR #8759](https://github.com/simstudioai/sim/pull/8759), merge `b4c38dfac7e3a0166d8abcd0d3325d0ca4cf1729`, is included in [v0.9.15](https://github.com/simstudioai/sim/releases/tag/v0.9.15).
- On October 12, 2026, the production Agent block definition returned the Nebius model options, and the [Nebius provider catalog](https://www.sim.ai/models/nebius) returned successfully. The article uses the provider catalog rather than a model page for a different provider.
- Nebius requires a customer-provided API key. Cloud workspace admins configure it in Workspace settings → BYOK → Nebius; self-hosted users supply it in the Agent block. There is no Nebius-specific plan restriction in the provider or BYOK settings. Model-specific features vary.
- The source PR records live API acceptance of the model catalog and adapter behavior. This publication adds no new model-execution claim or benchmark.
- The [Agent guide](https://docs.sim.ai/workflows/blocks/agent#nebius-token-factory) gains a focused Nebius setup section in this PR. Verify its anchor in the docs deployment before merging.

## Media provenance

Captured October 12, 2026, in the running self-hosted app from this PR's staging base. A disposable demo workspace uses a synthetic support-ticket prompt. Open the Agent block, search for `nebius` in Model, and inspect the actual options. The reviewed crop includes the Model label, search field, and model list.

Asset: `/changelog/nebius-model-picker-v1.jpg`, 510 × 268 pixels. Direct browser capture, cropped to the relevant panel; no controls or results were generated or altered. The image is displayed at its captured width on desktop to avoid enlarging small interface text. It opens in the existing shared image lightbox.

A still makes the new model choice easier to inspect than a setup video. No credential entry, saved placeholder key, or execution result is depicted. Availability is established separately above. These production notes are not public article copy.

## Publication review

- Review concise article and announcement copy against the released provider.
- Verify the provider catalog and the new Agent guide anchor.
- Inspect the article and shared lightbox on desktop and at a real 390px viewport.
- Run the content audit; use CI for repository test suites.
- Verify the deployed article, image, index, archive, RSS, and sitemap.
- Keep publication pending until the production canonical URL passes the publication monitor. A staging deployment is not production publication.

Canonical URL: https://www.sim.ai/changelog/nebius-models-for-agents

## Announcement drafts

Social:

> Use DeepSeek, Kimi, Qwen, and other open models through Nebius Token Factory in Sim. Bring your Nebius API key and choose a model in the Agent block. Setup and preview: https://www.sim.ai/changelog/nebius-models-for-agents

Email subject: Use Nebius Token Factory models in your agents

Email body:

> Nebius Token Factory is available in Sim's Agent block. Choose from open models including DeepSeek, Kimi, and Qwen, and use them with your existing prompts and connected tools. Bring your own Nebius API key to get started: https://www.sim.ai/changelog/nebius-models-for-agents

These are drafts. Distribute only after the production article and media are verified.
