import type { ComponentType } from 'react'

/**
 * The workspace entity kinds that can be `@`-mentioned in a markdown editor. A deliberate subset of
 * the chat's portable kinds (`chip-clipboard-codec.ts`) — the workspace-scoped ones that exist
 * without a workflow runtime context. The string values match that codec's `sim:<kind>/<id>` scheme,
 * so a mention link inserted here is parseable by `parseChipLinks()`.
 */
export type MentionKind =
  | 'file'
  | 'folder'
  | 'table'
  | 'knowledge'
  | 'workflow'
  | 'skill'
  | 'integration'

/** A single selectable entry in the `@` menu. */
export interface MentionItem {
  kind: MentionKind
  /** Entity id used as `sim:<kind>/<id>` in the inserted link. */
  id: string
  /** Display + link text. */
  label: string
  /** Category heading the item is shown under. */
  group: string
  /** Optional per-item icon (emcn category icon or a brand block icon). */
  icon?: ComponentType<{ className?: string }>
  /**
   * The query this item is one of the server's ranked matches for (files only). The menu keeps
   * it listed for that query rather than re-filtering it by substring.
   */
  matchedQuery?: string
}
