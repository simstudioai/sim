export const MothershipResourceType = {
  table: 'table',
  file: 'file',
  workflow: 'workflow',
  knowledgebase: 'knowledgebase',
  folder: 'folder',
  filefolder: 'filefolder',
  task: 'task',
  log: 'log',
  integration: 'integration',
  generic: 'generic',
  browser: 'browser',
  terminal: 'terminal',
} as const
export type MothershipResourceType =
  (typeof MothershipResourceType)[keyof typeof MothershipResourceType]

export interface MothershipResource {
  type: MothershipResourceType
  id: string
  title: string
  path?: string
  /** Saved table view to open pinned (type "table" only). */
  viewId?: string
  /**
   * The run this log row records (type "log" only). Distinct from `id`, which
   * is the log row's own key: the tab loads by row id, while chat context and
   * the logs deep-link address the run itself.
   */
  executionId?: string
}

/** A resource upsert may explicitly clear metadata that omission preserves. */
export interface MothershipResourceUpdate extends MothershipResource {
  /** Removes a table's saved-view pin instead of preserving it. */
  clearViewId?: true
}

/**
 * What a chip in an assistant message knows about the resource it points at,
 * before it has been resolved. The agent writes these tags as text, so a file
 * it just created is usually named but not yet identified. A ref becomes a
 * {@link MothershipResource} only through resolution, which may fail — see
 * {@link isAddressableResource} for why the unresolved state is modelled rather
 * than filled in.
 */
export interface WorkspaceResourceRef {
  type: MothershipResourceType
  id?: string
  path?: string
  title: string
}

interface ResourcePolicy {
  /** Stored with the chat, so the tab is still there when the chat is reopened. */
  persisted: boolean
  /**
   * Backed by something only the desktop app can provide. Still persisted, but
   * a client without the bridge leaves the tab out rather than restoring a
   * panel with nothing behind it.
   */
  desktopOnly?: boolean
}

/**
 * What the app does with each kind of resource, in one place.
 *
 * These rules used to live in three, and they disagreed. A client-side check
 * decided what to send, a Zod enum in the API contract decided what to accept,
 * and a runtime allowlist in the route handler decided again — but the enum
 * rejected `browser`, `task` and `integration` before the allowlist that
 * permitted them ever ran. Those tabs looked fine until the chat was reopened,
 * because the write had been failing the whole time into a warning log. The
 * contract enum and the handler now derive from this table, so a type can no
 * longer be openable and unsaveable at the same time.
 */
const RESOURCE_POLICY: Record<MothershipResourceType, ResourcePolicy> = {
  table: { persisted: true },
  file: { persisted: true },
  workflow: { persisted: true },
  knowledgebase: { persisted: true },
  folder: { persisted: true },
  filefolder: { persisted: true },
  task: { persisted: true },
  log: { persisted: true },
  integration: { persisted: true },
  // A synthetic panel with no addressable entity behind it to reopen.
  generic: { persisted: false },
  // One tab per live desktop page or shell, keyed by the native id. The
  // desktop app owns those lists and restores them itself, so the chat row
  // never stores these; they are re-derived from the live lists on open.
  browser: { persisted: false, desktopOnly: true },
  terminal: { persisted: false, desktopOnly: true },
}

/**
 * Resource types the chat will store. The API contract builds its enum from
 * this, which is what keeps client and server from drifting.
 */
export const PERSISTED_RESOURCE_TYPES = (
  Object.keys(RESOURCE_POLICY) as MothershipResourceType[]
).filter((type) => RESOURCE_POLICY[type].persisted) as [
  MothershipResourceType,
  ...MothershipResourceType[],
]

/** True when the resource's panel needs the desktop bridge to show anything. */
export function isDesktopOnlyResource(resource: MothershipResource): boolean {
  return RESOURCE_POLICY[resource.type]?.desktopOnly === true
}

export function isEphemeralResource(resource: MothershipResource): boolean {
  // The in-flight file preview is a placeholder that becomes a real file once
  // the write lands, so persisting it would restore a tab for a file that was
  // never created.
  if (resource.id === 'streaming-file') return true
  // An unrecognized type is treated as ephemeral: the server would reject it
  // anyway, and failing to store it is better than a write that always errors.
  return !RESOURCE_POLICY[resource.type]?.persisted
}

/**
 * Whether an id value names something the app can act on.
 *
 * This is the definition every layer defers to, so they cannot disagree about
 * whitespace. Takes `unknown` because two of its callers validate untrusted
 * input — a stream payload and a chat request body — before it has a type.
 */
export function hasAddressableId(id: unknown): boolean {
  return typeof id === 'string' && id.trim().length > 0
}

/**
 * True when the resource names something the app can actually act on.
 *
 * A blank id points at nothing: it cannot be opened, resolved into agent
 * context, or even removed, since the resources API requires a non-empty
 * `resourceId` to delete. Storing one used to be possible, and it made the chat
 * reject every later message — the write contract accepted `id: ''` while the
 * send schema required `min(1)`.
 */
export function isAddressableResource(resource: MothershipResource): boolean {
  return hasAddressableId(resource.id)
}

/**
 * Drops browser and terminal rows: older clients stored the desktop panels on
 * the chat, but their live tabs are derived from the desktop app rather than
 * the chat row. Module-private: callers want {@link sanitizeChatResources},
 * which also drops unaddressable resources.
 */
function withoutDesktopSessionResources(
  resources: readonly MothershipResource[]
): MothershipResource[] {
  return resources.filter((resource) => !RESOURCE_POLICY[resource.type]?.desktopOnly)
}

/**
 * The canonical form of a chat's resource list: legacy desktop panel rows and
 * unaddressable resources dropped. Every path that reads or writes stored
 * resources goes through this, which is what heals chats that already hold
 * one.
 */
export function sanitizeChatResources(
  resources: readonly MothershipResource[]
): MothershipResource[] {
  return withoutDesktopSessionResources(resources).filter(isAddressableResource)
}

/**
 * Applies a client-supplied order to the canonical stored entries. Reordering
 * carries identity only: metadata echoed by a stale tab must never overwrite a
 * newer pin, path, title, or execution id already persisted on the chat.
 */
export function reorderStoredChatResources(
  storedResources: readonly MothershipResource[],
  requestedOrder: readonly MothershipResource[]
): MothershipResource[] | null {
  const stored = sanitizeChatResources(storedResources)
  const requested = sanitizeChatResources(requestedOrder)

  // Compared as key SETS, not lengths: a chat that already holds a duplicated
  // row (nothing writes one today, but stored data predates the merge-by-key
  // writers) sends one fewer entry from the deduplicated client. Matching on
  // sets keeps that reorder valid and collapses the duplicate on write, where
  // a length check would reject every reorder for that chat forever.
  const storedByKey = new Map(
    stored.map((resource) => [`${resource.type}:${resource.id}`, resource])
  )
  const requestedKeys = Array.from(
    new Set(requested.map((resource) => `${resource.type}:${resource.id}`))
  )
  if (requestedKeys.length !== storedByKey.size) return null

  const reordered: MothershipResource[] = []
  for (const key of requestedKeys) {
    const resource = storedByKey.get(key)
    if (!resource) return null
    reordered.push(resource)
  }
  return reordered
}

/** Placeholder resource titles that a more specific title may overwrite during dedup. */
export const GENERIC_RESOURCE_TITLES = new Set<string>([
  'Table',
  'File',
  'Workflow',
  'Knowledge Base',
  'Folder',
  'Log',
])

/**
 * Every field {@link mergeChatResource} carries over from the newcomer. `type`
 * and `id` identify the entry and can never differ; `title` has its own
 * placeholder rule. Declared once so a field added to {@link MothershipResource}
 * fails to compile here rather than being silently dropped from both the merge
 * and its no-op check.
 */
const MERGED_FIELDS = {
  title: true,
  path: true,
  viewId: true,
  executionId: true,
} as const satisfies Record<Exclude<keyof MothershipResource, 'type' | 'id'>, true>

const MERGED_FIELD_NAMES = Object.keys(MERGED_FIELDS) as (keyof typeof MERGED_FIELDS)[]

/**
 * Folds a re-added resource into the stored entry with the same type+id. The
 * stored title wins unless it was a placeholder. Every other field the
 * newcomer defines replaces the stored one — a file's `path`, a log's
 * `executionId`, a table's saved-view pin (the tab reopens on the view the
 * agent touched last) — while a field the newcomer omits is kept, so an
 * unrelated row edit never unpins a table. Returns `prev` itself when nothing
 * changes, so callers can skip a no-op write.
 */
export function mergeChatResource(
  prev: MothershipResource | undefined,
  next: MothershipResourceUpdate
): MothershipResource {
  if (!prev) {
    // Copied, never aliased: the result lands in React state, the query cache
    // and the pending-write queue at once, and `next` is the caller's object.
    const { clearViewId: _clearViewId, ...resource } = next
    return resource
  }
  const { viewId: _previousViewId, ...prevWithoutViewId } = prev
  const merged: MothershipResource = {
    ...(next.clearViewId === true ? prevWithoutViewId : prev),
    ...(next.path !== undefined ? { path: next.path } : {}),
    ...(next.clearViewId !== true && next.viewId !== undefined ? { viewId: next.viewId } : {}),
    ...(next.executionId !== undefined ? { executionId: next.executionId } : {}),
    title:
      GENERIC_RESOURCE_TITLES.has(prev.title) && !GENERIC_RESOURCE_TITLES.has(next.title)
        ? next.title
        : prev.title,
  }
  const unchanged = MERGED_FIELD_NAMES.every((field) => merged[field] === prev[field])
  return unchanged ? prev : merged
}

/**
 * Coalesces durable updates that have not all reached the server yet. Unlike a
 * stored resource, the pending value must retain an explicit pin-clear until a
 * write succeeds; a later row edit that omits `viewId` must not cancel it.
 */
export function mergePendingChatResourceUpdate(
  prev: MothershipResourceUpdate | undefined,
  next: MothershipResourceUpdate
): MothershipResourceUpdate {
  let previousClearViewId: true | undefined
  let previousResource: MothershipResource | undefined
  if (prev) {
    const { clearViewId, ...resource } = prev
    previousClearViewId = clearViewId
    previousResource = resource
  }
  const merged = mergeChatResource(previousResource, next)
  const shouldClearViewId =
    next.viewId === undefined && (next.clearViewId === true || previousClearViewId === true)
  return shouldClearViewId ? { ...merged, clearViewId: true } : merged
}

export const VFS_DIR_TO_RESOURCE: Record<string, MothershipResourceType> = {
  tables: 'table',
  files: 'file',
  workflows: 'workflow',
  knowledgebases: 'knowledgebase',
  folders: 'folder',
} as const
