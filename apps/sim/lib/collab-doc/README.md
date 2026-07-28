# `@/lib/collab-doc` — server-side collaborative-document conversion

Server-side conversion between a file's **markdown** (the durable source of truth) and its
collaborative **Yjs document**, so the server can own the doc: seed it, project it back to
markdown, and let the agent write into it while a user is typing.

## Why this exists

Collaborative file editing had two writers with no shared CRDT: copilot `edit_content` wrote
markdown straight to the file while the user typed into an ephemeral, client-seeded Yjs doc. They
couldn't reconcile — the agent's edit didn't stream into the editor, and last-writer clobbered. The
fix is a **server-authoritative Yjs doc** both sides write into, with markdown as a projection.

## What Stage A (this module) provides

| Function | Purpose |
|---|---|
| `markdownToYDoc(md)` | Cold-start seed: file markdown → a fresh `Y.Doc`. |
| `yDocToMarkdown(ydoc)` | Projection: `Y.Doc` → the file's canonical markdown. |
| `applyMarkdownToYDoc(ydoc, md)` | Agent write: merge new content into a live `Y.Doc` as a minimal CRDT diff (no clobber). |

### Design decisions (why it's not hacky)

- **Parity by construction.** The markdown↔ProseMirror step reuses the *exact* client engine
  (`parseMarkdownToDoc` / `serializeDocToMarkdown`, `@tiptap/markdown` on the shared extension set) —
  not a second markdown implementation — so the server can never diverge from what the editor
  renders. The custom-fidelity constructs (tables, footnotes, raw HTML, `sim:` mentions) are covered
  by the same code that covers them in the browser; the round-trip test asserts equivalence.
- **Same Yjs binding as the browser.** ProseMirror↔Yjs uses `@tiptap/y-tiptap` (what TipTap's
  Collaboration extension uses), pinned to the same version and sharing the same `prosemirror-model`
  / `yjs` instances (peer deps) — so the structure the server produces is byte-compatible with the
  client, targeting the same `'default'` fragment.
- **Merge, not replace.** `applyMarkdownToYDoc` uses `updateYFragment` (the primitive `ySyncPlugin`
  runs on every keystroke) to apply only the diff, so Yjs reconciles the agent's write with in-flight
  remote edits. The test proves an agent write and a concurrent remote edit both survive.
- **Server-only, DOM via jsdom.** The markdown engine builds a (never-mounted) TipTap editor that
  needs a DOM; on the server it's backed by a single lazily-created `jsdom` window. Lazy-required so
  the client bundle never pulls jsdom in.

## Remaining stages (not in this PR)

- **Stage B — server-authoritative persistence + seeding.** DB column for the Yjs binary; realtime
  seeds/persists via this module; delete the client-seeder subsystem (election / deadlines /
  `triedSeeders` / `MAX_SEED_ROUNDS` / connect-deadline). Flag-gated.
- **Stage C — copilot into the doc + projection.** `edit_content` calls `applyMarkdownToYDoc` when a
  doc is live; a debounced `yDocToMarkdown` projection keeps the file current.
