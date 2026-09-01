import { parseAsString } from 'nuqs/server'

/**
 * `block` points an inbound link at one block, so a surface that knows where something lives —
 * the secret References tab, naming the block that carries a `{{KEY}}` — can land the reader on
 * it instead of on the workflow's default framing.
 *
 * The lone param on the editor route, and deliberately so: `.claude/rules/sim-url-state.md` keeps
 * the canvas's own view-state (pan, zoom, selection, drag) in Zustand because it is
 * socket-synced, high-frequency, or a persisted preference. This is none of those. It is a
 * read-once navigation signal, consumed on arrival and stripped, in the same family as
 * integrations' `?connect=` — not canvas state that lives in the URL.
 *
 * Nullable with no default: absent means "no target", which is the overwhelmingly common case.
 */
export const focusBlockParam = {
  key: 'block',
  parser: parseAsString,
} as const
