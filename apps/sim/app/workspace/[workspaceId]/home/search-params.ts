import { parseAsString } from 'nuqs/server'

/**
 * Co-located, typed URL query-param definition for the home/Chat surface.
 *
 * `resource` deep-links the resource panel to the selected resource. The active
 * resource id is the single source of truth for which resource the panel shows;
 * `useChat` reads and writes it through this param, and the effective selection
 * is derived against the loaded resource list (an unknown/stale id falls back to
 * the last resource). The URL key is `resource` — existing shared links depend on
 * it, so it must not be renamed.
 */
export const resourceParam = {
  key: 'resource',
  parser: parseAsString,
} as const

/**
 * Selecting a resource is a filter-like view change, not back-stack navigation,
 * so it replaces the current history entry (matching the previous
 * `window.history.replaceState` behavior). `clearOnDefault` drops the key from
 * the URL when no resource is active.
 */
export const resourceUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const

/** Signals that a cached Home surface should consume a pending one-shot chat handoff. */
export const mothershipHandoffParam = {
  key: 'handoff',
  parser: parseAsString,
} as const

/** Removes the transient handoff signal without adding a browser-history entry. */
export const mothershipHandoffUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const

/** Builds a fresh-chat URL that wakes the handoff consumer without exposing prompt text. */
export function getMothershipHandoffHref(workspaceId: string): string {
  return `/workspace/${workspaceId}/home?${mothershipHandoffParam.key}=1`
}
