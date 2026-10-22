# Help Scout comes to Sim

Status: editorial draft. Availability and media require review before an article is added.

## Editorial selection

Story type: feature

Help Scout integration (PRs 9252 + 9253, both v0.9.30) is the strongest lead: an entirely new integration with concrete user-facing capabilities—conversation management, webhook triggers with auto-registration, and a knowledge base connector—all live-tested against a real Help Scout account in PR 9253. No other PRs in the evidence packet provide competing features. No 'Also in' section because no additional PRs with the same release tag are present in the evidence. Operation counts (37 tools, 13 triggers) are kept out of public copy per editorial policy. Trigger OAuth requirement added as an access restriction from PR 9253 evidence.

## Proposed article

Sim adds a Help Scout integration for managing conversations, customers, and inboxes—with a knowledge base connector and auto-registered webhook triggers for conversation and customer events.

The Help Scout block lets agents and workflows search and read conversations with threads, send replies, add internal notes, change status and assignee, manage tags and custom fields, snooze conversations, and update customer profiles. Webhook triggers fire on conversation and customer events—such as created, replied to, assigned, or tagged—and Sim registers each webhook automatically when you deploy a trigger, then removes it when you undeploy. A knowledge base connector syncs conversations and threads from one inbox or all of them, so agents can search past support history.

Connect your Help Scout account through [OAuth or an app credential](https://docs.sim.ai/integrations/helpscout); the connected user needs the **Access API** permission. Triggers require an OAuth connection. To sync support history, add Help Scout as a [knowledge base source](https://docs.sim.ai/knowledgebase/connectors). Self-hosted deployments need `HELPSCOUT_CLIENT_ID` and `HELPSCOUT_CLIENT_SECRET`; see [Integrations and OAuth](https://docs.sim.ai/platform/self-hosting/integrations-oauth).

## Editorial review

- Removed operation counts ('13 webhook triggers', '37 tools') from all public copy per editorial policy against putting totals in headlines, summaries, bodies, or notes.
- Changed 'support queues' to 'inboxes' in summary to match Help Scout terminology used in evidence.
- Added trigger OAuth requirement: PR 9253 explicitly states triggers need an OAuth connection and app credentials are refused at deploy. This is an important access restriction.
- Removed 'now' from social and 'We've added' from email to comply with policy against claiming availability before human publication review.
- Simplified body from exhaustive operation inventory to most useful capabilities, per policy to choose representative actions rather than listing every one.
- Moved knowledge base connector to second paragraph with setup links per editorial format (lead paragraph explains change, second paragraph has setup and access requirements).
- PR 9252 was not live-tested against Help Scout; PR 9253 was live-tested. Combined readiness should be confirmed by owner.

## Source evidence

- The Help Scout block supports managing conversations including listing, searching, reading threads, creating, replying, drafting, adding notes, changing status, assignee, inbox, subject, tags, and custom fields, snoozing, and deleting. — simstudioai/sim#9252, simstudioai/sim#9253
- Webhook triggers cover conversation and customer events; deploying a trigger auto-registers the Help Scout webhook with a generated signing secret, and undeploying removes it. — simstudioai/sim#9253
- A knowledge base connector syncs Help Scout conversations and threads (optionally including internal notes) from one inbox or all inboxes. — simstudioai/sim#9253
- Connect via OAuth or by creating a Help Scout app under Your Profile > My Apps and pasting its App ID and App Secret; the connected user needs the Access API permission. — simstudioai/sim#9252, simstudioai/sim#9253
- Self-hosted deployments require HELPSCOUT_CLIENT_ID and HELPSCOUT_CLIENT_SECRET environment variables. — simstudioai/sim#9252
- Triggers require a Help Scout account connected through OAuth; app credentials are refused at deploy. — simstudioai/sim#9253

- https://github.com/simstudioai/sim/pull/9252
- https://github.com/simstudioai/sim/pull/9253

## Availability and open questions

- [ ] Confirm both OAuth and app-credential flows are available on Sim Cloud at launch, or is one flow Cloud-only?
- [ ] Is the knowledge base connector available to all plans or restricted to specific tiers?
- [ ] PR 9252 was not verified against a live Help Scout account; PR 9253 was. Confirm the combined integration is production-ready for announcement.
- [ ] Confirm no staggered rollout between 9252 and 9253—both are v0.9.30.

## Links checked during drafting

- [Help Scout integration guide](https://docs.sim.ai/integrations/helpscout)
- [Knowledge base connectors](https://docs.sim.ai/knowledgebase/connectors)
- [Integrations and OAuth (self-hosting)](https://docs.sim.ai/platform/self-hosting/integrations-oauth)
- [Help Scout on sim.ai](https://www.sim.ai/integrations/help-scout)

## Media production

Format: screenshot
Subject: Help Scout block in the Sim workflow canvas
Starting state: Workflow canvas open with a Help Scout block placed and selected, operation picker closed
Action: User opens the operation picker on the Help Scout block
Visible result: Operation picker is open showing representative actions such as List Conversations, Create Reply, Add Note, Assign Conversation
Poster: Operation picker fully open with multiple Help Scout actions visible and the block title and icon clearly readable
Framing: 390px wide canvas view, block centered, picker dropdown fully visible, no credentials or account data shown, clean sample workspace
Demonstration limits: Capture requires a real Help Scout block in a live Sim workspace with credentials configured through the actual settings flow beforehand; do not show fake key entry or placeholder credentials; verify picker actions match the shipped operation list before capture

Screenshot of the Help Scout block in the Sim workflow canvas with the operation picker open, showing representative actions. Clean sample workspace at 390px width. No credentials, account data, or placeholder key entry visible.

1. Open a workflow canvas with a Help Scout block placed and selected
2. Open the operation dropdown to show representative actions (e.g., List Conversations, Create Reply, Add Note, Assign Conversation)
3. Ensure the block title 'Help Scout' and the Help Scout icon are clearly visible
4. Capture at 390px width with readable text; credentials must be configured beforehand through the real settings flow

Suggested alt text: Sim workflow canvas showing a Help Scout block with its operation picker open, displaying actions including List Conversations, Create Reply, and Add Note.

- [ ] Independently verify the feature and rollout; record evidence and limitations.
- [ ] Review a product capture, verified diagram, or original editorial illustration; retain capture or generation provenance.
- [ ] Choose the final image or video poster; verify it reads clearly at 390px. Candidate assets are not approved media.
- [ ] Add optimized versioned media, captions if spoken, and index.mdx with draft: true.
- [ ] Verify the final media on desktop and mobile and run the content audit.
- [ ] Feature owner confirms availability; editor approves copy and links.
- [ ] After the approved site deployment, verify article, media, RSS and sitemap before marking published.

## Announcement drafts

**Social**

The Help Scout integration in Sim manages conversations, sends replies, adds notes, updates customers, and triggers workflows on support events. Sync Help Scout history into a knowledge base for agents to search. https://docs.sim.ai/integrations/helpscout

**Email**

The Help Scout integration in Sim lets your agents and workflows manage conversations, send replies, add notes, update customers, and trigger workflows on support events. Sync your conversation history into a knowledge base so agents can search how past issues were resolved. Connect via OAuth or a Help Scout app credential. See the guide: https://docs.sim.ai/integrations/helpscout

Final canonical URL is assigned when the reviewed article slug is chosen. Do not distribute these drafts before publication.

Editorial contract: apps/sim/content/changelog/README.md and editorial-standard.md. This brief is public repository content; keep private operational evidence in Sim.
