# Quick-chat window comes to Sim desktop

Status: editorial draft. Availability and media require review before an article is added.

## Editorial selection

Story type: feature

The quick-chat window (simstudioai/sim#10025) is the strongest lead: it adds a genuinely new user-facing capability — a global-shortcut overlay chat that floats above all apps and spaces, scoped to the last workspace, with configurable shortcut and 'Open in Sim' handoff. It outranks the automated-turn display improvement (#10032), which is useful but narrower polish. Both carry the v0.9.58 release tag, so a supporting note is valid. Other PRs in the batch are infrastructure, security maintenance, or lack the v0.9.58 tag.

## Proposed article

Sim's desktop app adds a floating chat window triggered by a global keyboard shortcut, so you can talk to your agent without leaving whatever you're working in.

The quick-chat window in Sim's desktop app floats above every other application and stays open until you close it. Press the shortcut to show the panel; press it again to hide it — the conversation stays intact. On macOS the window appears over full-screen apps and on every Space without bringing the main Sim window forward. Chats are scoped to the workspace or organization you were last in, and an **Open in Sim** button hands the conversation to a full window while the panel stays open.

The shortcut defaults to ⌥ Space on macOS and Ctrl+Shift+J elsewhere. You can change it — or turn it off — in desktop settings, and it is also reachable from the File menu and the menu-bar item. Settings indicate when another app already holds your chosen shortcut. See the [desktop guide](https://docs.sim.ai/desktop) for setup details.

### Also in v0.9.58

- Background task and scheduled job turns appear as chat messages with a label showing what triggered them (e.g. "Timer finished · 02:12 PM" or a job title and run number) instead of a system chip.

## Editorial review

- Removed 'now' from summary, social, and email to comply with the rule that automatic drafts must not claim current rollout status.
- Added 'while the panel stays open' to the body's Open in Sim sentence — the PR test confirms the panel remains open after handoff; the original draft omitted this useful detail.
- Added a question about whether the no-preload-bridge limitation (agent cannot drive browser/terminal/apps from the quick-chat window) should be disclosed in the announcement.
- Both PRs merged to staging with availability Unverified; publication requires owner confirmation of production availability.
- Media end_state updated to note the panel stays visible alongside the full window, matching the PR's tested behavior.

## Source evidence

- The quick-chat window floats above every other application and, on macOS, appears over full-screen apps and on every Space without pulling the main Sim window forward. — simstudioai/sim#10025
- The conversation is preserved when the panel is hidden and restored when the shortcut is pressed again. — simstudioai/sim#10025
- The shortcut defaults to ⌥ Space on macOS and Ctrl+Shift+J elsewhere, is configurable in desktop settings, and settings indicate when another app already holds the chosen shortcut. — simstudioai/sim#10025
- 'Open in Sim' hands the chat to a full window while leaving the panel open. — simstudioai/sim#10025
- Background task and scheduled job turns render as chat messages with a label (e.g. 'Timer finished · 02:12 PM' or job title and run number) instead of a centered system chip. — simstudioai/sim#10032
- Both changes carry the v0.9.58 release tag; availability on production is unverified and requires owner confirmation before publication. — simstudioai/sim#10025, simstudioai/sim#10032

- https://github.com/simstudioai/sim/pull/10025
- https://github.com/simstudioai/sim/pull/10032

## Availability and open questions

- [ ] Can the quick-chat window be confirmed as shipped in a public desktop release build, or is it still on staging?
- [ ] Does the quick-chat window require a minimum macOS or Windows version?
- [ ] Is the automated-turn message display (supporting note) confirmed live for all users on v0.9.58?
- [ ] The PR notes the quick-chat window gets no preload bridge, so the agent cannot drive the browser, terminal, or apps from it — should this limitation be mentioned in the announcement?

## Links checked during drafting

- [Desktop guide](https://docs.sim.ai/desktop)
- [Chat docs](https://docs.sim.ai/chat)

## Media production

Format: video · 30 seconds
Subject: Sim desktop quick-chat window opened over a macOS full-screen app
Starting state: macOS full-screen app visible, Sim running in background with no window shown
Action: User presses ⌥ Space; quick-chat panel appears over the full-screen app; user sends a message and receives a reply; user clicks 'Open in Sim'
Visible result: Full Sim window is in the foreground showing the same conversation, quick-chat panel still visible
Poster: Full Sim window open with conversation visible
Framing: Record at native resolution, crop to show the floating panel clearly over the background app; ensure workspace name and 'Open in Sim' button are legible at 390px width
Demonstration limits: Capture against a real Sim desktop build with valid credentials and an active workspace; do not fabricate UI elements or simulate a key press without the real shortcut handler firing; verify the panel appears over a genuine full-screen macOS app

Record a 25–35 second screen capture on macOS showing the quick-chat window being opened with the global shortcut from a full-screen app, a short message exchange, and then the 'Open in Sim' button handing off to the full window. End on the full Sim window as the poster frame.

1. Ready state: macOS desktop with a full-screen app (e.g. a text editor) visible and Sim running in the background — no Sim window shown
2. Action 1: Press ⌥ Space; the quick-chat panel slides in over the full-screen app, showing the workspace name at the top
3. Action 2: Type a short message and receive a reply in the floating panel
4. Action 3: Click 'Open in Sim'; the full Sim window comes forward with the same conversation, panel still visible
5. Poster moment: Full Sim window open with the conversation visible

Suggested alt text: Sim's quick-chat panel floating over a macOS full-screen app, showing a short conversation and an Open in Sim button

- [ ] Independently verify the feature and rollout; record evidence and limitations.
- [ ] Review a product capture, verified diagram, or original editorial illustration; retain capture or generation provenance.
- [ ] Choose the final image or video poster; verify it reads clearly at 390px. Candidate assets are not approved media.
- [ ] Add optimized versioned media, captions if spoken, and index.mdx with draft: true.
- [ ] Verify the final media on desktop and mobile and run the content audit.
- [ ] Feature owner confirms availability; editor approves copy and links.
- [ ] After the approved site deployment, verify article, media, RSS and sitemap before marking published.

## Announcement drafts

**Social**

Sim's desktop app adds a quick-chat window. Press a global shortcut and a floating panel appears over whatever you're working in — scoped to your last workspace, conversation intact when you hide it, and 'Open in Sim' takes it full when you need more. Configure the shortcut in desktop settings.

**Email**

Sim's desktop app includes a quick-chat window you can open from anywhere with a keyboard shortcut.

The panel floats above every app and Space on macOS, stays scoped to your last workspace, and keeps your conversation when you hide it. Press the shortcut again to bring it back, or click 'Open in Sim' to move to a full window.

The shortcut defaults to ⌥ Space on macOS and Ctrl+Shift+J elsewhere. Change it or turn it off in desktop settings.

Details: https://docs.sim.ai/desktop

Final canonical URL is assigned when the reviewed article slug is chosen. Do not distribute these drafts before publication.

Editorial contract: apps/sim/content/changelog/README.md and editorial-standard.md. This brief is public repository content; keep private operational evidence in Sim.
