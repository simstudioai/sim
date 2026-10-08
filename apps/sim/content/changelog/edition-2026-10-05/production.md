# More reliable follow-ups in Sim Chat

Status: editorial draft. Availability and real media require review before an article is added.

## Editorial selection

Recommended placement: supporting Chat improvements in a related release. The editor should confirm a substantial standalone benefit before promoting these fixes into a separate announcement. Keep the brief in draft while that decision, availability, and feature-specific media are unresolved.

## Proposed article

Sim improves how Chat handles interrupted sends, helping follow-up messages stay in order and attached to the right conversation.

Keep adding context while a message is being sent. If that send fails while the browser still reports a connection, Chat retries it and keeps the original message ahead of follow-ups you queued.

When a new chat is being created, pending follow-ups stay attached to that conversation. Together, these fixes address specific cases where a message could get stuck or reappear in the wrong queue; they do not guarantee delivery through every network interruption.

See the [Chat guide](https://docs.sim.ai/chat) for working with Sim.

## Source evidence

- A chat message whose POST failed due to a network interface change or reset connection (while the browser stayed online) would sit in the queue indefinitely until a page reload. — simstudioai/sim#8726
- The fix retries such a send on a backoff timer (1 second, growing to 30 seconds) and the server deduplicates retries by message ID. — simstudioai/sim#8726
- When a direct send's POST failed, the message was re-queued at the tail, behind follow-ups typed during the failed request, so follow-ups could be sent before the original message. — simstudioai/sim#8738
- The fix re-inserts a failed direct send at the head of the queue to preserve message order. — simstudioai/sim#8738
- On the new-chat surface, a follow-up queued while the first message's POST was pending could be re-queued under a stale key after Send-now, causing it to disappear from the chat queue and potentially be sent into a different new chat. — simstudioai/sim#8741
- The fix tracks where a new-chat queue key migrates and resolves late queue writes to the correct chat. — simstudioai/sim#8741

- https://github.com/simstudioai/sim/pull/8726
- https://github.com/simstudioai/sim/pull/8738
- https://github.com/simstudioai/sim/pull/8741

## Availability and open questions

- [ ] Confirm the production build includes PRs #8726, #8738 and #8741, including subsequent corrections and reverts.
- [ ] Verify normal follow-ups, an online request failure, and the new-chat migration case in a dedicated demo environment.
- [ ] Confirm desktop and browser scope, relevant rollout flags and any remaining limitations before removing draft status.

## Links checked during drafting

- [Chat documentation](https://docs.sim.ai/chat)

## Media production

Capture a real dedicated demo conversation with sample prompts. Show a first request and a queued follow-up, then their arrival in order. This normal-path recording illustrates the interaction; it does not prove network recovery. A second controlled test must fail a send while the browser remains online to verify the specific retry fix. Do not toggle the operator’s whole machine offline. Record the deployed build, capture date and exact scenario. Keep private sidebar titles and account details out of the frame. Use a 20–45 second video with a real poster, or a clearly captioned screenshot of the queued follow-up; add captions if there is speech.

1. Open a dedicated sample Chat and hide private sidebar content.
2. Send a harmless first request, then queue a follow-up while it runs.
3. Capture the queued state and then the ordered result. Label this as the normal interaction.
4. Separately verify an online request failure and the new-chat migration case in an isolated test environment; do not imply the normal-path video proves either failure case.
5. Export a short MP4 and poster; inspect legibility on mobile and record any demonstrated limitations.

Suggested alt text: Proposed: A sample Sim Chat with a follow-up waiting behind the current request. Match the final wording to the actual capture.

- [ ] Capture the real feature with sample data; record environment, date, permissions and limitations.
- [ ] Review a feature image or a focused 20–45 second recording and its poster. No fabricated UI or results.
- [ ] Add optimized versioned media, captions if spoken, and index.mdx with draft: true.
- [ ] Verify the final media on desktop and mobile and run the content audit.
- [ ] Feature owner confirms availability; editor approves copy and links.
- [ ] After the approved site deployment, verify article, media, RSS and sitemap before marking published.

## Announcement drafts

**Social**

Draft: More reliable follow-ups in Sim Chat. Improvements to failed sends and new-chat queues help messages stay in order and in the right conversation. Add the reviewed article URL after deployment.

**Email**

Draft: Sim improves how Chat handles follow-up messages after a failed send and while a new conversation is created. Read the reviewed update for availability and a demonstration. Add the canonical URL after deployment.

Final canonical URL is assigned when the reviewed article slug is chosen. Do not distribute these drafts before publication.

Editorial contract: apps/sim/content/changelog/README.md. This brief is public repository content; keep private operational evidence in Sim.

## Editor capture note

The ordinary queued-message demo illustrates the interaction only. Verify the online-request failure and new-chat migration cases separately before making recovery claims. Confirm the current deployed build and keep private sidebar content out of the capture.
