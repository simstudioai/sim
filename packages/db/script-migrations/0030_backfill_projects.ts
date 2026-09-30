import type { ScriptMigration } from '@sim/db/script-migrations/types'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import type { Sql } from 'postgres'

const logger = createLogger('BackfillProjects')

/** Lineages committed per transaction when creating projects. */
const PROJECT_BATCH_SIZE = 200
/** Chats scanned per transaction when recording the projects they worked in. */
const CHAT_BATCH_SIZE = 500

/**
 * A trailing environment word on a workspace name names its environment; the rest names the
 * project. Frozen copy of `apps/sim/lib/projects/lineage.ts` (migrations cannot import apps).
 */
const ENVIRONMENT_SUFFIX =
  /^(.*?)[\s-]+(prod|production|staging|stage|sandbox|dev|development|test|uat|qa)$/i
/** What a fork is called when its name carries no environment word, by depth below the root. */
const DEPTH_LABELS = ['Prod', 'Staging', 'Sandbox'] as const

function parseEnvironmentName(name: string): { base: string; environment: string | null } {
  const match = ENVIRONMENT_SUFFIX.exec(name.trim())
  if (!match) return { base: name.trim(), environment: null }
  const word = match[2]
  return {
    base: match[1].trim(),
    environment: word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
  }
}

interface WorkspaceRow {
  id: string
  name: string
  organization_id: string | null
  forked_from_workspace_id: string | null
}

interface Placement {
  rootId: string
  depth: number
}

/**
 * Each workspace's lineage root and depth, following `forked_from_workspace_id` while the parent
 * exists. A cycle (which the write paths never create) stops at the first repeated workspace.
 */
export function resolveLineagePlacements(
  workspaces: readonly Pick<WorkspaceRow, 'id' | 'forked_from_workspace_id'>[]
): Map<string, Placement> {
  const parents = new Map(workspaces.map((w) => [w.id, w.forked_from_workspace_id]))
  const placements = new Map<string, Placement>()
  for (const w of workspaces) {
    let rootId = w.id
    let depth = 0
    const seen = new Set([rootId])
    for (;;) {
      const parent = parents.get(rootId)
      if (!parent || !parents.has(parent) || seen.has(parent)) break
      seen.add(parent)
      rootId = parent
      depth += 1
    }
    placements.set(w.id, { rootId, depth })
  }
  return placements
}

/** The environment label a lineage member gets: its name's word, else its depth's default. */
export function environmentLabel(name: string, depth: number): string {
  return parseEnvironmentName(name).environment ?? DEPTH_LABELS[depth] ?? `Fork ${depth}`
}

/** A project's name: the lineage root's name without a trailing environment word. */
export function projectName(rootName: string): string {
  return parseEnvironmentName(rootName).base || rootName.trim() || 'Untitled project'
}

/**
 * Puts every workspace in exactly one project: one project per fork lineage, named after the
 * lineage's root and owned by the root's organization (none for a personal workspace). Resumable:
 * workspaces already placed are skipped, and a lineage whose root already has a project gains its
 * remaining members there.
 */
export async function backfillProjectMemberships(
  sql: Sql
): Promise<{ projects: number; memberships: number }> {
  const workspaces = await sql<WorkspaceRow[]>`
    SELECT id, name, organization_id, forked_from_workspace_id FROM workspace
  `
  const placed = new Map(
    (
      await sql<{ workspace_id: string; project_id: string }[]>`
        SELECT workspace_id, project_id FROM project_workspace
      `
    ).map((row) => [row.workspace_id, row.project_id])
  )
  const byId = new Map(workspaces.map((w) => [w.id, w]))
  const placements = resolveLineagePlacements(workspaces)

  const unplacedByRoot = new Map<string, WorkspaceRow[]>()
  for (const w of workspaces) {
    if (placed.has(w.id)) continue
    const rootId = placements.get(w.id)?.rootId ?? w.id
    const members = unplacedByRoot.get(rootId) ?? []
    members.push(w)
    unplacedByRoot.set(rootId, members)
  }

  const roots = [...unplacedByRoot.keys()].sort()
  let projects = 0
  let memberships = 0
  for (let start = 0; start < roots.length; start += PROJECT_BATCH_SIZE) {
    const batch = roots.slice(start, start + PROJECT_BATCH_SIZE)
    await sql.begin(async (tx) => {
      for (const rootId of batch) {
        const root = byId.get(rootId)
        if (!root) continue
        let projectId = placed.get(rootId)
        if (!projectId) {
          projectId = generateId()
          await tx`
            INSERT INTO project (id, name, organization_id)
            VALUES (${projectId}, ${projectName(root.name)}, ${root.organization_id})
          `
          projects += 1
        }
        for (const member of unplacedByRoot.get(rootId) ?? []) {
          const depth = placements.get(member.id)?.depth ?? 0
          const inserted = await tx`
            INSERT INTO project_workspace (project_id, workspace_id, environment, position)
            VALUES (${projectId}, ${member.id}, ${environmentLabel(member.name, depth)}, ${depth})
            ON CONFLICT (workspace_id) DO NOTHING
          `
          memberships += inserted.count
        }
      }
    })
  }
  return { projects, memberships }
}

/**
 * Records the projects each chat worked in: the project of the chat's own workspace and of every
 * workspace its resources live in. Idempotent (`ON CONFLICT DO NOTHING`), and must run before a
 * chat's workspace owner is cleared, which is when that workspace would otherwise be lost.
 */
export async function backfillChatProjects(sql: Sql): Promise<number> {
  let afterId = '00000000-0000-0000-0000-000000000000'
  let recorded = 0
  for (;;) {
    const page = await sql<{ id: string }[]>`
      SELECT id FROM copilot_chats WHERE id > ${afterId}::uuid ORDER BY id LIMIT ${CHAT_BATCH_SIZE}
    `
    if (page.length === 0) return recorded
    const lastId = page[page.length - 1].id
    const inserted = await sql`
      INSERT INTO copilot_chat_project (chat_id, project_id)
      SELECT DISTINCT c.id, pw.project_id
      FROM copilot_chats c
      CROSS JOIN LATERAL (
        SELECT c.workspace_id AS workspace_id
        UNION
        SELECT resource ->> 'workspaceId'
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(c.resources) = 'array' THEN c.resources ELSE '[]'::jsonb END
        ) AS resource
      ) AS touched
      JOIN project_workspace pw ON pw.workspace_id = touched.workspace_id
      WHERE c.id > ${afterId}::uuid AND c.id <= ${lastId}::uuid
      ON CONFLICT DO NOTHING
    `
    recorded += inserted.count
    afterId = lastId
  }
}

export const backfillProjectsMigration: ScriptMigration = {
  name: '0030_backfill_projects',
  async up(sql) {
    const { projects, memberships } = await backfillProjectMemberships(sql)
    const chatProjects = await backfillChatProjects(sql)
    logger.info('Backfilled projects', { projects, memberships, chatProjects })
  },
}
