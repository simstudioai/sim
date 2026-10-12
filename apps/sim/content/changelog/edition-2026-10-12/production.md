# Use Nebius Token Factory models in your agents

Status: editorial draft. Availability and real media require review before an article is added.

## Editorial selection

Story type: feature

Nebius Token Factory is a new BYOK provider with 24 verified models, a verified docs link, and a model catalog link — a clear, concrete feature story. Buffer's expanded API coverage is a strong second candidate but the Nebius story is more self-contained and has richer model catalog evidence. The remaining PRs are internal fixes, CI maintenance, or supporting improvements that do not meet the standalone announcement bar.

## Proposed article

Sim adds Nebius Token Factory as a bring-your-own-key provider, giving agents access to 24 open models including DeepSeek, Kimi, Cerebras, and Qwen variants.

Nebius Token Factory is a new provider in Sim's model picker. Add your Nebius API key in workspace settings, then select any of the 24 models — including DeepSeek V4 Pro, Kimi K3, Cerebras GPT-OSS 120B, and Qwen variants — in an Agent block. Models support streaming, tool use, image input, and structured outputs where the model allows. See the [Agent block docs](https://docs.sim.ai/workflows/blocks/agent) for setup details.

## Editorial review

- Removed 'now' from social copy to avoid unsupported rollout phrasing.
- Changed media_plan framing from split-panel layout to sequential single-panel shots to meet 390px readability requirement.
- Trimmed links from four model-specific pages to one documentation link plus one representative model page.
- Replaced provider API identifier 'Qwen3.5-397B-A17B' with display-friendly 'Qwen 3.5 variant' in claim 2.
- Changed email opening from 'We've added' to declarative phrasing consistent with unverified availability.

## Source evidence

- Nebius Token Factory is added as a BYOK provider with 24 verified models, the official Nebius icon, and support for streaming, tools, images, and native or prompt-based JSON schemas through the shared OpenAI-compatible adapter. — simstudioai/sim#8759
- Models include DeepSeek V4 Pro, DeepSeek V4.1 Flash, Kimi K3, Kimi K2.7-Code, Kimi K2.6, Cerebras GPT-OSS 120B, a Qwen 3.5 variant set as the default model, MiniMax M3, Gemma 3 27B, Hermes 4 405B, NVIDIA Nemotron, and others across a range of context windows and pricing tiers. — simstudioai/sim#8759
- The provider fails closed when a configured BYOK key cannot be decrypted, and normalizes saved forced-tool settings when the selected model does not support forced tool choice. — simstudioai/sim#8759
- Live API acceptance testing confirmed all 24 models returned expected answers; picker IDs, image input, native and fallback JSON, streaming, and real HTTP tool loops passed. One model timed out once and passed an isolated retry. — simstudioai/sim#8759
- Model catalog pages for DeepSeek V4 Pro, Cerebras GPT-OSS 120B, Kimi K3, Kimi K2.7-Code, Kimi K2.6, and ZAI GLM variants are referenced in the evidence docs list. — simstudioai/sim#8759
- Availability is unverified; merging to staging does not confirm production deployment or general availability. — simstudioai/sim#8759

- https://github.com/simstudioai/sim/pull/8759

## Availability and open questions

- [ ] Is Nebius Token Factory available to all plan tiers or restricted to specific plans?
- [ ] Has this been deployed to production, or is it still staged?
- [ ] Are all 24 models listed in the public model catalog at sim.ai?
- [ ] One model timed out once during live acceptance testing — is that model considered stable for production use?
- [ ] Does the BYOK settings UI for Nebius require any specific key format or scope beyond a standard Nebius API key?

## Links checked during drafting

- [Agent block setup](https://docs.sim.ai/workflows/blocks/agent)
- [DeepSeek V4 Pro on Sim](https://www.sim.ai/models/deepseek/deepseek-v4-pro)

## Media production

Format: video · 30 seconds
Subject: Selecting a Nebius Token Factory model in a Sim Agent block after adding a BYOK key
Starting state: Workspace settings open to the BYOK / API Keys section; no Nebius key configured
Action: User adds a Nebius API key in BYOK settings, then opens an Agent block and selects DeepSeek V4 Pro from the Nebius section of the model picker
Visible result: Agent block displays DeepSeek V4 Pro as the selected model; Nebius models are visible in the picker list
Poster: Frame showing the model picker open with Nebius models listed and DeepSeek V4 Pro highlighted or selected
Framing: Single focal panel per shot; cut between BYOK settings and Agent block model picker so model names and key fields remain readable at 390px
Demonstration limits: Does not prove all 24 models are available in production, that the BYOK key is accepted server-side with a real credential, or that tool use and streaming function end-to-end

Record a short screen capture showing a user adding a Nebius API key in Sim workspace settings, then opening an Agent block and selecting a Nebius model (e.g. DeepSeek V4 Pro) from the model picker. Use a clean demo workspace with no real credentials visible. Pause on the model picker showing Nebius models listed.

1. Open workspace Settings and navigate to the API Keys / BYOK section — show the Nebius provider entry with its icon
2. Enter a placeholder Nebius API key and save — show the key accepted
3. Open an Agent block in a workflow canvas and open the model picker — show Nebius models listed including DeepSeek V4 Pro, Kimi K3, and Cerebras GPT-OSS 120B
4. Select DeepSeek V4 Pro — hold on the block showing the selected model name for reading

Suggested alt text: Sim Agent block model picker showing Nebius Token Factory models including DeepSeek V4 Pro, Kimi K3, and Cerebras GPT-OSS 120B

- [ ] Capture the real feature with sample data; record environment, date, permissions and limitations.
- [ ] Review a feature image or a focused 20–45 second recording. Use consistent product theme and sample data.
- [ ] Choose the poster from the visible result; verify the relevant panel is readable at 390px. Candidate frames are not approved assets.
- [ ] Add optimized versioned media, captions if spoken, and index.mdx with draft: true.
- [ ] Verify the final media on desktop and mobile and run the content audit.
- [ ] Feature owner confirms availability; editor approves copy and links.
- [ ] After the approved site deployment, verify article, media, RSS and sitemap before marking published.

## Announcement drafts

**Social**

Nebius Token Factory is a BYOK provider in Sim. Add your key and pick from 24 open models — DeepSeek, Kimi, Cerebras, Qwen, and more — directly in your Agent blocks. https://docs.sim.ai/workflows/blocks/agent

**Email**

Nebius Token Factory is a bring-your-own-key provider in Sim. Once you add your Nebius API key in workspace settings, all 24 supported models appear in the Agent block model picker. That includes DeepSeek V4 Pro, Kimi K3, Cerebras GPT-OSS 120B, and several Qwen variants. Models support streaming, tool use, image input, and structured outputs where available. Details: https://docs.sim.ai/workflows/blocks/agent

Final canonical URL is assigned when the reviewed article slug is chosen. Do not distribute these drafts before publication.

Editorial contract: apps/sim/content/changelog/README.md and editorial-standard.md. This brief is public repository content; keep private operational evidence in Sim.
