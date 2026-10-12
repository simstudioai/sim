# New model choices: production record

Status: prepared for publication in the changelog refresh PR.

## Evidence and availability

- [PR #8777](https://github.com/simstudioai/sim/pull/8777), commit `df34c6721d`, included in [v0.9.15](https://github.com/simstudioai/sim/releases/tag/v0.9.15), published October 8, 2026.
- Checked native OpenAI `gpt-6.1-sol`, Anthropic `claude-haiku-5-5`, and xAI `grok-4.7` entries in `providers/models.ts`. The provider/model links use the generated catalog's slug rules.
- The claim is availability in the Agent block, not model quality, pricing, speed, or a universal Cloud rollout. Provider credentials and model access remain prerequisites.

## Media provenance

Captured October 9, 2026 (October 10 UTC), from the running local app at commit `36f91a76e2`. A dedicated disposable workspace contains a sample support-ticket agent and Slack step. Open the Agent block's editor and its model picker. The selected option is GPT-6.1 Sol; the image demonstrates configuration, not an executed response or a comparison benchmark.

Asset: `/changelog/agent-model-picker-v1.jpg`, 1280 × 720 pixels. Direct browser screenshot, with the product's light theme and collapsed sidebar. No generated UI, credentials, model output, or external account data. The article uses the same image for sharing and the shared image lightbox.

## Editorial review

The release timestamp is preserved as the feature's historical release date. This new story has its own canonical RSS identity; it does not claim the entire v0.9.15 release URL as its identity. Review the public article, all three model destinations, the Agent block guide, lightbox, and mobile layout before merging. CI runs the content and repository gates; no local test suite is required for this refresh.

## Announcement draft

Choose GPT-6.1 Sol, Claude Haiku 5.5, or Grok 4.7 for an Agent block in Sim. Keep your prompts and integrations, then review the model settings and try your sample input. Setup: https://www.sim.ai/changelog/new-models-for-agents

Draft only; no announcement has been sent.
