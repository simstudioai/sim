import { db } from '@sim/db'
import {
  credential,
  customTools,
  folder,
  knowledgeBase,
  mcpServers,
  skill,
  userTableDefinitions,
  workflow,
} from '@sim/db/schema'
import { compareStrings, slugify } from '@sim/utils/string'
import type { ResourceKeyResolver, ResourceKind } from '@sim/workflow-code'
import { and, asc, eq, isNull } from 'drizzle-orm'

/**
 * Resource keys for workflow source: `table('leads')`, `kb('docs')`, `binding('support-slack')`.
 *
 * PROVISIONAL. Until the repo phase adds a binding table, a key is derived from the resource's
 * current name: its slug, with `-2`, `-3`, … for later resources whose slug is already taken
 * (ordered by creation time, then id, so the assignment is deterministic). A rename therefore
 * changes the key, and deleting the older of two same-named resources moves the bare key to the
 * newer one. Keys are a read-side projection only: nothing stores them yet.
 *
 * Credentials are keyed by display name and print as `binding(key)`. A kind with no workspace
 * table here (`sandbox`, `file`, …), a deleted or archived resource, and an id from another
 * workspace all resolve to `null`, which canonicalize keeps verbatim as `$sim: 'unresolved'`.
 */

/** Rows per kind read to assign keys; past it, later-created resources stay unresolved. */
const MAX_RESOURCES_PER_KIND = 50_000

interface ResourceRow {
  id: string
  name: string
  createdAt: Date
}

type ResourceLoader = (workspaceId: string) => Promise<ResourceRow[]>

const LOADERS: Partial<Record<ResourceKind, ResourceLoader>> = {
  table: (workspaceId) =>
    db
      .select({
        id: userTableDefinitions.id,
        name: userTableDefinitions.name,
        createdAt: userTableDefinitions.createdAt,
      })
      .from(userTableDefinitions)
      .where(
        and(
          eq(userTableDefinitions.workspaceId, workspaceId),
          isNull(userTableDefinitions.archivedAt)
        )
      )
      .orderBy(asc(userTableDefinitions.createdAt), asc(userTableDefinitions.id))
      .limit(MAX_RESOURCES_PER_KIND),
  'knowledge-base': (workspaceId) =>
    db
      .select({
        id: knowledgeBase.id,
        name: knowledgeBase.name,
        createdAt: knowledgeBase.createdAt,
      })
      .from(knowledgeBase)
      .where(and(eq(knowledgeBase.workspaceId, workspaceId), isNull(knowledgeBase.deletedAt)))
      .orderBy(asc(knowledgeBase.createdAt), asc(knowledgeBase.id))
      .limit(MAX_RESOURCES_PER_KIND),
  workflow: (workspaceId) =>
    db
      .select({ id: workflow.id, name: workflow.name, createdAt: workflow.createdAt })
      .from(workflow)
      .where(and(eq(workflow.workspaceId, workspaceId), isNull(workflow.archivedAt)))
      .orderBy(asc(workflow.createdAt), asc(workflow.id))
      .limit(MAX_RESOURCES_PER_KIND),
  'custom-tool': (workspaceId) =>
    db
      .select({ id: customTools.id, name: customTools.title, createdAt: customTools.createdAt })
      .from(customTools)
      .where(eq(customTools.workspaceId, workspaceId))
      .orderBy(asc(customTools.createdAt), asc(customTools.id))
      .limit(MAX_RESOURCES_PER_KIND),
  'mcp-server': (workspaceId) =>
    db
      .select({ id: mcpServers.id, name: mcpServers.name, createdAt: mcpServers.createdAt })
      .from(mcpServers)
      .where(and(eq(mcpServers.workspaceId, workspaceId), isNull(mcpServers.deletedAt)))
      .orderBy(asc(mcpServers.createdAt), asc(mcpServers.id))
      .limit(MAX_RESOURCES_PER_KIND),
  skill: (workspaceId) =>
    db
      .select({ id: skill.id, name: skill.name, createdAt: skill.createdAt })
      .from(skill)
      .where(eq(skill.workspaceId, workspaceId))
      .orderBy(asc(skill.createdAt), asc(skill.id))
      .limit(MAX_RESOURCES_PER_KIND),
  credential: (workspaceId) =>
    db
      .select({ id: credential.id, name: credential.displayName, createdAt: credential.createdAt })
      .from(credential)
      .where(eq(credential.workspaceId, workspaceId))
      .orderBy(asc(credential.createdAt), asc(credential.id))
      .limit(MAX_RESOURCES_PER_KIND),
  'file-folder': (workspaceId) =>
    db
      .select({ id: folder.id, name: folder.name, createdAt: folder.createdAt })
      .from(folder)
      .where(
        and(
          eq(folder.workspaceId, workspaceId),
          eq(folder.resourceType, 'file'),
          isNull(folder.deletedAt)
        )
      )
      .orderBy(asc(folder.createdAt), asc(folder.id))
      .limit(MAX_RESOURCES_PER_KIND),
}

/** Bidirectional id ↔ key maps for one kind. */
interface KindKeys {
  byId: Map<string, string>
  byKey: Map<string, string>
}

/**
 * Assigns each resource its provisional key: the name's slug (or the kind when the slug is
 * empty), suffixed `-2`, `-3`, … when an earlier resource already holds it. Earlier means
 * created first, ties broken by id, whatever order `rows` arrives in.
 */
export function assignResourceKeys(kind: ResourceKind, rows: readonly ResourceRow[]): KindKeys {
  const ordered = [...rows].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || compareStrings(a.id, b.id)
  )
  const byId = new Map<string, string>()
  const byKey = new Map<string, string>()
  for (const row of ordered) {
    if (byId.has(row.id)) continue
    const base = slugify(row.name) || kind
    let key = base
    for (let suffix = 2; byKey.has(key); suffix += 1) key = `${base}-${suffix}`
    byId.set(row.id, key)
    byKey.set(key, row.id)
  }
  return { byId, byKey }
}

/**
 * Loads the resource keys of `kinds` in one workspace and returns a resolver over them. Only
 * this workspace's live resources are read, so an id from elsewhere never resolves.
 */
export async function loadResourceKeyResolver(
  workspaceId: string,
  kinds: Iterable<ResourceKind>
): Promise<ResourceKeyResolver> {
  const loaded = new Map<ResourceKind, KindKeys>()
  await Promise.all(
    [...new Set(kinds)].map(async (kind) => {
      const load = LOADERS[kind]
      if (!load) return
      loaded.set(kind, assignResourceKeys(kind, await load(workspaceId)))
    })
  )
  return {
    toKey: (kind, id) => loaded.get(kind)?.byId.get(id) ?? null,
    toId: (kind, key) => loaded.get(kind)?.byKey.get(key) ?? null,
  }
}
