# Manual test plan — chat-scoped outputs + Fork/Duplicate (PR #5401)

Ordered from smoke tests to edge cases. Each test lists exact steps, the
expected result, and what a failure would implicate. Tests marked
**[KNOWN — observe, don't file]** exercise a tracked ISSUES.md item: confirm
the behavior matches the entry, but a "failure" there is expected.

## Setup

- **S1.** Run sim + mothership dev servers, migrations applied through `0255`
  (if the DB predates the branch, run the `0255` pre-check from the PR body:
  no duplicate `(chat_id, display_name)` rows `WHERE context='output'`).
- **S2.** Enable the mothership `chat-scoped-outputs` flag. All parts assume
  flag ON except Part E's flag-off test.
- **S3.** Test assets on disk: any small image (`test.png`), a 5-row
  `small.csv`, and a >5MB CSV:
  `python3 -c "print('a,b,c'); [print(f'{i},{i*2},xxxxxxxxxxxxxxxxxxxxxxxx') for i in range(250000)]" > big.csv`
- **S4.** Keep the browser devtools console open — several fixed bugs used
  to manifest only as `logger.warn` lines.
- **S5.** Optional but valuable: a second user account that is a member of
  the same workspace (for test 36).

## Part A — Outputs namespace basics

- **1. Generate an output.** New chat → type: *"Generate an image of a red
  circle on a white background."*
  **Expect:** tool call succeeds; the reply embeds/links the image; the "+"
  resource picker's Files group lists it (e.g. `outputs/…png`); it does NOT
  appear on the Files page.
- **2. Create a text output.** Same chat → *"Create a file outputs/notes.md
  with the content 'hello world'."*
  **Expect:** agent confirms; file appears in the "+" picker.
- **3. Open as a tab — and confirm read-only (round-6 fix).** Click the
  `outputs/notes.md` link in the reply (or add via "+").
  **Expect:** tab opens, content renders, and there is NO editor — no
  editable text area, no autosave, no repeating save-error toasts. The image
  output from test 1 previews normally in its own tab.
- **4. Active-tab context (round-6 fix).** With the `outputs/notes.md` tab
  active, send: *"Summarize the file in my active tab."*
  **Expect:** the model answers about notes.md specifically. Failure mode
  this guards: model asks "which file?" or answers about something else.
- **5. Write-once enforcement.** Send: *"Overwrite outputs/notes.md with
  'goodbye'."*
  **Expect:** the tool FAILS with an error that mentions outputs are
  write-once and names the `files/outputs/…` spelling. No silent replace.
- **6. Same-name collision.** Send: *"Create outputs/notes.md again with
  different content."*
  **Expect:** a suffixed sibling (e.g. `notes (1).md`) — never an overwrite,
  never a DB error surfaced to chat.
- **7. Materialize to workspace.** Send: *"Save outputs/notes.md to my
  workspace files."*
  **Expect:** file appears on the Files page under `files/`; the chat output
  still exists in the picker.
- **8. Tab actions.** On an output tab: Download works; the "Open in files"
  button is HIDDEN (outputs dead-end on the Files page by design).
- **9. Large CSV output preview (round-6 fix, best-effort).** If you can
  produce a >5MB CSV *output* (e.g. via a table export to outputs if
  available), open it as a tab.
  **Expect:** the table preview loads rows — pre-fix this was a permanent
  "File not found". If you can't produce one, skip — the route is pinned by
  `csv-preview/route.test.ts`.

## Part B — Fork & Duplicate

- **10. Basic duplicate.** Build a chat: 2–3 exchanges, one drag-dropped
  upload (`test.png`), one generated output. Right-click the chat in the
  sidebar → Duplicate.
  **Expect:** new chat `<name> (Copy)` with EVERY message; image embeds
  render; the picker shows the copied files; downloads work in the copy.
- **11. Copy independence.** Delete the ORIGINAL chat, then reopen the copy.
  **Expect:** embeds still render, files still download — bytes were
  physically copied and references re-pointed. (Blob orphaning from the
  original's delete is invisible here — **[KNOWN #2]** server-side.)
- **12. Branch fork with a cut.** In a chat where an upload arrived at
  message 1 and an output was generated after message 3: click Fork on the
  FIRST assistant reply.
  **Expect:** new chat `Fork | <name>` containing only messages up to and
  including that reply; the upload IS present; the post-cut output is NOT;
  no ghost chips in the picker for files the fork doesn't have.
- **13. Fork the just-streamed reply.** Send a message, and the moment the
  reply finishes, click Fork on it.
  **Expect:** fork opens normally (the pre-fix bug 400'd on the synthetic
  live-message id).
- **14. Fork/duplicate titles.** Fork the fork from test 12; duplicate it too.
  **Expect:** titles stay sane — `Fork | <base>` (never `Fork | Fork | …`),
  `<name> (Copy)`.
- **15. Rapid double duplicate.** Right-click → Duplicate twice in quick
  succession.
  **Expect:** two distinct copies, distinct names, no errors.
- **16. Quota accounting.** Check storage usage (settings) before/after
  duplicating the media-heavy chat.
  **Expect:** usage increased by the copied bytes (deliberate). Deleting the
  copy does NOT refund — **[KNOWN #1 — observe, don't file]**.

## Part C — Fixed-bug regression checks (rounds 1–6)

- **17. Reference image is actually used.** Drag-drop a distinctive photo
  into chat → *"Generate an image using my uploaded photo as reference, but
  with a blue sky."*
  **Expect:** the result visibly derives from the reference. Pre-fix,
  generation silently ignored it and used the prompt alone.
- **18. Unresolvable reference fails loudly.** *"Generate an image using
  uploads/does-not-exist.png as reference."*
  **Expect:** the tool call FAILS with a clear error — not a prompt-only
  generation.
- **19. UUID attachment ids resolve (round-6 fix).** With the drag-dropped
  upload from test 17 (presign path → UUID row id): *"Convert my uploaded
  image to grayscale with ffmpeg."*
  **Expect:** the tool resolves the attachment and runs. Pre-fix, ids not
  starting with `wf_` never resolved.
- **20. Failed tool calls surface their error.** *"Read the file
  files/definitely-not-real-xyz.md."*
  **Expect:** the tool block shows the actual error text and the model
  responds to it sensibly ("that file doesn't exist…"). Failure mode this
  guards: bare `{}` result + the model blindly retrying many times.
- **21. The reconnect-wedge scenario, end to end.** From the home surface
  (fresh chat), first message: *"Create outputs/wedge-test.md with 'x'."*
  When the reply renders the outputs/ link, click it, then send a second
  message.
  **Expect:** the tab opens AND the second send succeeds immediately.
  Pre-fix this minted an empty-id resource, 400'd the send, and wedged the
  UI in "running" for ~3 minutes.
- **22. Failed send rolls back.** Stop the mothership dev process (or go
  offline) → send a message.
  **Expect:** prompt error ("Failed to send message"), the optimistic
  message is removed, UI returns to idle — no endless reconnect spinner.
  Restart the backend; sending works again. (If a POST dies AFTER the server
  accepted it, a duplicate assistant run is possible — **[KNOWN R0]**.)
- **23. Resume after refresh.** Ask for a long answer; refresh the page
  mid-stream.
  **Expect:** the stream resumes/reattaches and the reply completes — the
  terminal-404 change must not have broken live resume.

## Part D — Touched-surface regressions (old behavior, unchanged)

- **24. Plain chat.** Multi-turn conversation with no files: send, receive,
  Stop mid-stream, send again. All normal.
- **25. Workspace file tools.** *"Create files/reg-test.md with 'hi'"*, then
  rename it, read it, delete it — all four verbs work as before.
- **26. Files page.** Upload `big.csv` via the Files UI; open it: the CSV
  table preview loads (>5MB workspace path must still work). Open a
  workspace markdown file: it IS still editable — the round-6 read-only
  gate must apply ONLY to chat outputs.
- **27. open_resource for workspace assets.** *"Open files/reg-test.md"*,
  *"open workflow <name>"*, *"open table <name>"* — tabs open for each.
- **28. Table import from a chat upload.** Drag-drop `small.csv` into chat →
  *"Import this CSV into a new table."*
  **Expect:** table created with the rows (chat-scoped storage context is
  honored through the background import).
- **29. Knowledge add.** *"Add files/reg-test.md to knowledge base <name>"*
  and *"add outputs/notes.md to knowledge base <name>"* — both ingest.
- **30. Resource picker, non-file types.** Via "+": add a workflow, a table,
  a knowledge base; reorder tabs; remove them. All fine. Clicking a
  file-FOLDER entry 400s — **[KNOWN #11 — observe, don't file]**.
- **31. @-mention.** Type `@` and mention a workspace file — works. Chat
  outputs do NOT appear in @-mention — **[KNOWN R4]** (they do appear in
  the "+" picker; that asymmetry is the tracked bug).
- **32. VFS over workspace files.** *"List the files in files/"*, *"search
  my files for 'hi'"* — glob/grep/read on the workspace namespace normal.
  `glob("outputs/*.png")` returning ALL outputs regardless of pattern is
  **[KNOWN #6]**.
- **33. Doc images.** Edit a doc that references a workspace image via
  edit_content.
  **Expect:** images stage/compile as before. An outputs/-referenced image
  silently dropping is **[KNOWN R7]**.

## Part E — Flag, permissions, and obscure edges

- **34. Flag OFF.** Disable `chat-scoped-outputs` in mothership → new chat →
  *"Generate an image of a green square."*
  **Expect:** pre-PR behavior (agent isn't steered to outputs/); normal chat
  works end to end. A hallucinated explicit `outputs/…` write still creating
  a chat-scoped output is the ACCEPTED flag-off behavior (see ISSUES.md
  "Accepted"), not a bug.
- **35. Cross-user output access.** As user B (same workspace): copy the
  serve/download URL of user A's chat output and open it.
  **Expect:** denied/404 — outputs are private to the owning chat's user.
  B's own chats and workspace files unaffected.
- **36. Namespace shadowing.** Create a real workspace folder literally
  named `outputs` with a file in it. In a chat, *"read outputs/<that file>"*.
  **Expect:** resolves against the CHAT namespace and misses —
  **[KNOWN #8]**; the canonical `files/outputs/<file>` spelling works.
- **37. Uploads/ create guard.** *"Create a file uploads/guard-test.md."*
  **Expect (current, tracked):** falls through to `files/` prefixing and the
  agent may create a literal `uploads` workspace folder — **[KNOWN R3 —
  observe, don't file]**. (The same request with `outputs/` is properly
  rejected — that's test 5's guard.)
- **38. Legacy empty-id resource cleanup.** If any chat predating the branch
  carries a broken resource chip (empty id): removing it still works — the
  remove contract stayed permissive on purpose.
- **39. Delete a chat with outputs.** Delete a chat that generated outputs.
  **Expect:** chat gone, no client errors. Server-side blob orphaning is
  **[KNOWN #2]** — nothing observable here; listed for completeness.

## Result log

Track results as: `#N PASS` / `#N FAIL — <what you saw>` / `#N SKIP`.
Anything that fails outside the **[KNOWN …]** markers is a new finding —
add it to ISSUES.md with the file/mechanism if identifiable.
