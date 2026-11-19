# Agents can create reminders, events, and contacts

Status: editorial draft. Availability and media require review before an article is added.

## Editorial selection

Story type: feature

The lead story is the computer-use app commands feature (PR #10196): agents on the Sim desktop app can create reminders, calendar events, and contacts through native macOS commands with a user-confirmation dialog, eliminating dozens of GUI automation calls per task. This is a genuinely new capability—not a fix or maintenance item—and it changes what agents can accomplish. It outranks the CLI search-source management PR (no releaseTag, admin-only, unverified availability) and the integration fixes (routine correctness work). The two related computer-use bug fixes (#10188 panel windows, #10176 settings visibility) are directly relevant and strengthen the coherent story, though they carry v0.9.63 tags while the lead has no releaseTag. Because not all selected sources share the same tag, no 'Also in' section is used; the fixes are mentioned as directly related notes in the body.

## Proposed article

Sim's desktop app lets agents create reminders, calendar events, and contacts through native macOS commands, with a confirmation dialog showing exact fields before any write is saved.

When computer use is enabled on the Sim desktop app, agents can create reminders, calendar events, and contacts through native macOS commands instead of driving each GUI field individually. Timed or all-day events can be scheduled up to 31 days out with an optional alert. Every create triggers a confirmation dialog showing the exact fields, with Cancel as the default—a declined write returns without touching any data. List operations require no confirmation. If the required macOS permission has not been granted, the command fails before any data is touched.

See the [desktop guide](https://docs.sim.ai/desktop) for setup and permission requirements. The capability appears in Settings under Reminders, Calendar, and Contacts permission rows, and is offered only when computer use is allowed for the chat.

Two related computer-use fixes also improve the desktop experience: controls appear correctly in organization and account settings, and panel-level windows such as Calendar's event inspector are observable by the agent.

## Editorial review

- Removed all instances of 'now' and 'newly available' per automatic-draft guidelines; phrasing describes capability without claiming rollout.
- Removed EventKit reference from public copy (body, social, email); kept it in claims as supporting evidence. Public copy says 'native macOS commands' instead.
- Original draft said 'This release also fixes two desktop issues'—reworded because the lead PR (#10196) has no releaseTag while the two fixes are v0.9.63; they may not ship in the same build. Body says 'Two related computer-use fixes also improve the desktop experience' without claiming shared release.
- No 'Also in vX.Y.Z' section because the selected sources do not all share the same releaseTag.
- The companion server-side change (referenced in PR body) must be confirmed landed before this feature is usable end-to-end—flagged in questions and proof_limit.
- Availability of all three PRs is Unverified (staging merges); publication requires feature-owner confirmation.

## Source evidence

- Agents can create reminders, calendar events (timed or all-day, up to 31 days, with optional alert), contact groups, and contacts through native EventKit commands when computer use is enabled on the desktop app. — simstudioai/sim#10196
- Every create command shows a native confirmation dialog with the exact fields; Cancel is the default, and a declined write returns user_declined without touching any data. — simstudioai/sim#10196
- The capability is advertised only by desktop shells that support it and only when computer use is already allowed for the chat; list operations require no confirmation. — simstudioai/sim#10196
- Computer use controls now appear in organization and account settings, not only workspace settings; an organization-only user can enable computer use for organization chats. — simstudioai/sim#10176
- Panel-level windows such as Calendar's event inspector are observable by the computer-use agent, resolving errors where the agent could not select or type into those windows. — simstudioai/sim#10188
- PR #10196 has no releaseTag and availability is listed as Unverified; rollout status must be confirmed by the feature owner before publication. — simstudioai/sim#10196

- https://github.com/simstudioai/sim/pull/10196
- https://github.com/simstudioai/sim/pull/10188
- https://github.com/simstudioai/sim/pull/10176

## Availability and open questions

- [ ] PR #10196 has no releaseTag and availability is Unverified—has this shipped, or does it require a specific desktop build? Please confirm before publishing.
- [ ] The companion server-side change must land first per the PR—has that landed? Is the feature fully available end-to-end?
- [ ] Which desktop app version first includes this capability? Should the announcement reference a minimum version?
- [ ] Are Reminders, Calendar, and Contacts commands available to all desktop users, or gated behind an Enterprise or organization permission?
- [ ] Do PRs #10188 and #10196 ship together in the same desktop build, or are they in different versions?

## Links checked during drafting

- [Desktop guide](https://docs.sim.ai/desktop)
- [Chat guide](https://docs.sim.ai/chat)

## Media production

Format: video · 30 seconds
Subject: Sim desktop agent creating a calendar event via native app command
Starting state: Sim Chat open on desktop, computer use enabled and Calendar permission granted through Settings, agent prompted to schedule a meeting
Action: Agent issues create_event command; native macOS confirmation dialog appears showing event title, date, time, and alert fields with Cancel as default; user clicks confirm
Visible result: Agent reports event created; Calendar app shows the new event
Poster: Confirmation dialog visible with event fields and Cancel as default button
Framing: Full desktop window at readable size, dialog centered, no personal data in any field, capture at 390px readable width
Demonstration limits: Capture requires a real macOS desktop build with computer use and Calendar permission granted through actual settings flow; do not fabricate dialog or event result; confirm the companion server-side change has landed before capture; availability is Unverified so confirm the feature is live end-to-end before scheduling capture

Record a 30-second desktop screen capture showing an agent creating a calendar event via the new app command. The confirmation dialog should appear with the event's exact fields, the user confirms, and the event appears in Calendar. Use a clean sample workspace with no real personal data. Computer use and Calendar permission must be granted through the real settings flow before capture.

1. Ready state: Sim Chat open on desktop with computer use enabled, agent prompted to schedule a meeting
2. Agent issues the create_event command; native confirmation dialog appears showing event title, date, time, and optional alert fields with Cancel as default
3. User clicks the confirm button; agent reports the event was created
4. Calendar app briefly visible showing the newly created event

Suggested alt text: Sim desktop app showing a native confirmation dialog for a new calendar event, with event title and time fields visible and Cancel as the default button

- [ ] Independently verify the feature and rollout; record evidence and limitations.
- [ ] Review a product capture, verified diagram, or original editorial illustration; retain capture or generation provenance.
- [ ] Choose the final image or video poster; verify it reads clearly at 390px. Candidate assets are not approved media.
- [ ] Add optimized versioned media, captions if spoken, and index.mdx with draft: true.
- [ ] Verify the final media on desktop and mobile and run the content audit.
- [ ] Feature owner confirms availability; editor approves copy and links.
- [ ] After the approved site deployment, verify article, media, RSS and sitemap before marking published.

## Announcement drafts

**Social**

Sim's desktop app can create reminders, calendar events, and contacts through native macOS commands—no GUI automation needed. Every write shows a confirmation dialog with exact fields before anything is saved. Computer use must be enabled. Details: https://docs.sim.ai/desktop

**Email**

Sim's desktop app adds native commands for Reminders, Calendar, and Contacts. When computer use is on, agents can create reminders, timed or all-day events, and contacts through native macOS commands. Every write triggers a confirmation dialog showing the exact fields—Cancel is the default. List operations need no confirmation, and a missing permission stops the command before it touches anything. See the desktop guide to set up permissions: https://docs.sim.ai/desktop

Final canonical URL is assigned when the reviewed article slug is chosen. Do not distribute these drafts before publication.

Editorial contract: apps/sim/content/changelog/README.md and editorial-standard.md. This brief is public repository content; keep private operational evidence in Sim.
