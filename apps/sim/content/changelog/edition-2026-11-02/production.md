# Chat requires a paid plan on hosted Sim

Status: editorial draft. Availability and media require review before an article is added.

## Editorial selection

Story type: action_required

The Chat plan gate (#9551 + #9553, both v0.9.40) is the strongest story: it introduces a concrete access requirement affecting every free-plan hosted workspace across all Chat surfaces. #9557 is a directly related UX companion merged the same day but lacks a v0.9.40 tag — flagged in questions. Other batch items (desktop improvements, file-streaming fix, People page behind flag, search internals) are either scoped to different apps, secondary to this billing gate, or unverified. The lead is action_required because free hosted users face a changed access requirement with a clear next step.

## Proposed article

Sim Chat on hosted deployments requires a paid plan or admin-granted prepaid credits. Free-plan users see a plan-required notice above the composer instead of being able to send messages.

On hosted Sim deployments, Chat requires a paid plan or prepaid credits granted by an admin. Free-plan users see a "Paid Plan Required" notice above the composer; the send button stays disabled and any draft is preserved. The notice directs billing managers to the upgrade page and tells other members who can act.

This applies to every surface that starts a Chat run: the web interface, the v2 API, the Sim Chat block, scheduled jobs, Slack, and knowledge-base chat. Members of paid team and enterprise workspaces are unaffected. Self-hosted deployments are unaffected. Scheduled jobs on free-plan workspaces are skipped rather than cancelled and resume once the plan changes. See [Chat](https://docs.sim.ai/chat) for details.

## Editorial review

- Removed 'now' from summary, body, social, and email per automatic-draft policy — human publication review establishes rollout timing.
- Changed 'paused' to 'skipped' for scheduled jobs on free-plan workspaces to match the evidence (skipped_budget status), which is more accurate than implying a global pause.
- #9557 (the composer UX improvement) has no v0.9.40 releaseTag; it is used as part of the coherent lead story, not as a standalone supporting note. Question retained for owner confirmation.
- #9553 (the 402 bug fix) is kept in claims only — it is a technical reliability fix directly related to the billing gate, not suitable for the user-facing body.
- Confirmed claim scope: the PR says 'task wakes' and 'KB chat/MCP' — mapped to user-facing terms 'scheduled jobs' and 'knowledge-base chat' in public copy.

## Source evidence

- Chat on hosted deployments requires a paid plan or admin-granted prepaid credits; free-plan users see a plan-required card above the composer with the send button disabled. — simstudioai/sim#9551, simstudioai/sim#9557
- The plan gate applies to web Chat, the v2 API, the Sim Chat block, scheduled jobs, Slack, and knowledge-base/MCP chat. — simstudioai/sim#9551
- Members of paid team and enterprise workspaces are unaffected; self-hosted deployments are unaffected. — simstudioai/sim#9551
- Scheduled jobs for free-plan workspaces are marked skipped_budget rather than cancelled, so they resume when the plan changes. — simstudioai/sim#9551
- The composer preserves the user's draft while the send button is disabled; the notice routes billing managers to the upgrade page and tells other members who can upgrade. — simstudioai/sim#9557
- A transient DB error during Copilot key validation previously caused a paying payer to be refused with a 402; this is corrected to a retryable 500. — simstudioai/sim#9553

- https://github.com/simstudioai/sim/pull/9551
- https://github.com/simstudioai/sim/pull/9557
- https://github.com/simstudioai/sim/pull/9553

## Availability and open questions

- [ ] Does #9557 ship in v0.9.40 alongside #9551, or in a later tag? It is merged to staging but carries no releaseTag.
- [ ] Is the prepaid-credits path (admin-granted credits allowing free-plan access) documented publicly, or is it internal only?
- [ ] What is the upgrade path for self-hosted users running a hosted Copilot key on a free account — is the 402 behavior documented?
- [ ] Please confirm Cloud rollout timing before publishing.

## Links checked during drafting

- [Chat](https://docs.sim.ai/chat)

## Media production

Format: screenshot
Subject: Sim Chat composer on a free-plan hosted workspace
Starting state: Chat home screen open, composer visible, no notice shown yet — workspace is on a free plan
Action: The plan-required notice appears above the composer; user types a draft message to show send remains disabled
Visible result: Composer shows draft text, send button disabled, 'Paid Plan Required' card visible above with upgrade button
Poster: Composer with draft text, disabled send button, and plan-required card fully visible
Framing: Full-width Chat home view at 390px minimum, card and composer both in frame, readable text
Demonstration limits: Capture requires a real hosted Sim workspace on a free plan running the v0.9.40 build. Configure the workspace through the real settings flow. Do not simulate or fake the billing state. Verify the notice renders and send is disabled before recording. Independent feature verification required before publication.

Show the plan-required notice appearing above the Chat composer for a free-plan workspace, with the send button disabled and draft text preserved. Capture on a real hosted Sim workspace running v0.9.40 on a free plan.

1. Open the Chat home screen on a free-plan hosted workspace showing the empty state with the 'Paid Plan Required' card above the composer
2. Type a message draft into the composer to show the send button remains disabled while the draft is preserved
3. Show the card's upgrade call-to-action button as a billing manager would see it

Suggested alt text: Sim Chat composer with a 'Paid Plan Required' notice above the input field and the send button disabled

- [ ] Independently verify the feature and rollout; record evidence and limitations.
- [ ] Review a product capture, verified diagram, or original editorial illustration; retain capture or generation provenance.
- [ ] Choose the final image or video poster; verify it reads clearly at 390px. Candidate assets are not approved media.
- [ ] Add optimized versioned media, captions if spoken, and index.mdx with draft: true.
- [ ] Verify the final media on desktop and mobile and run the content audit.
- [ ] Feature owner confirms availability; editor approves copy and links.
- [ ] After the approved site deployment, verify article, media, RSS and sitemap before marking published.

## Announcement drafts

**Social**

Sim Chat on hosted deployments requires a paid plan or admin-granted prepaid credits. Free-plan users see a plan notice above the composer — drafts are preserved and billing managers can upgrade directly from the notice.

**Email**

Sim Chat on hosted deployments requires a paid plan or admin-granted prepaid credits.

If your workspace is on a free plan, you'll see a "Paid Plan Required" notice above the Chat composer. Your draft is preserved. Billing managers can reach the upgrade page directly from the notice; other members will see who can act.

This applies to web Chat, the v2 API, the Sim Chat block, scheduled jobs, Slack, and knowledge-base chat. Members of paid team and enterprise workspaces and all self-hosted deployments are unaffected.

See the Chat docs for details: https://docs.sim.ai/chat

Final canonical URL is assigned when the reviewed article slug is chosen. Do not distribute these drafts before publication.

Editorial contract: apps/sim/content/changelog/README.md and editorial-standard.md. This brief is public repository content; keep private operational evidence in Sim.
