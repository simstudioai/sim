import type { db } from '@sim/db'
import { project, projectWorkspace, workspace } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, notExists, type SQL, sql } from 'drizzle-orm'
import type { PgInsertValue } from 'drizzle-orm/pg-core'

type FixtureDatabase = typeof db
type FixtureTransaction = Parameters<Parameters<FixtureDatabase['transaction']>[0]>[0]
type WorkspaceRow = Omit<
  PgInsertValue<typeof workspace>,
  'id' | 'projectId' | 'forkedFromWorkspaceId'
> & {
  id: string
  projectId?: string
  forkedFromWorkspaceId?: string | null
}

/** Seeds real environments with the Project membership required by the migrated schema. */
export async function insertWorkspaceFixture(
  database: FixtureDatabase | FixtureTransaction,
  values: WorkspaceRow | WorkspaceRow[]
) {
  return database.transaction(async (tx) => {
    const inputs = Array.isArray(values) ? values : [values]
    const byId = new Map(inputs.map((row) => [row.id, row]))
    const children = new Map<string, WorkspaceRow[]>()
    const ordered: WorkspaceRow[] = []
    for (const row of inputs) {
      if (row.forkedFromWorkspaceId && byId.has(row.forkedFromWorkspaceId)) {
        const siblings = children.get(row.forkedFromWorkspaceId) ?? []
        siblings.push(row)
        children.set(row.forkedFromWorkspaceId, siblings)
      } else ordered.push(row)
    }
    for (const row of ordered) ordered.push(...(children.get(row.id) ?? []))
    if (ordered.length !== inputs.length) throw new Error('Workspace fixture contains a fork cycle')
    const inserted = new Map<string, typeof workspace.$inferSelect>()
    const createdProjectIds = new Set<string>()
    for (const row of ordered) {
      const [parent] = row.forkedFromWorkspaceId
        ? await tx
            .select({ projectId: workspace.projectId })
            .from(workspace)
            .where(eq(workspace.id, row.forkedFromWorkspaceId))
        : []
      if (row.forkedFromWorkspaceId && !parent)
        throw new Error('Workspace fixture parent does not exist')
      if (parent && row.projectId && row.projectId !== parent.projectId)
        throw new Error('Workspace fixture cannot fork across Projects')
      const projectId = row.projectId ?? parent?.projectId ?? generateId()
      if (!parent && !createdProjectIds.has(projectId)) {
        const [existing] = await tx
          .select({ id: project.id })
          .from(project)
          .where(eq(project.id, projectId))
        if (!existing) {
          await tx.insert(project).values({
            id: projectId,
            name: 'Fixture project',
            ownerId: row.ownerId,
            organizationId: row.organizationId,
          })
          createdProjectIds.add(projectId)
        }
      }
      const [created] = await tx
        .insert(workspace)
        .values({ ...row, projectId })
        .returning()
      inserted.set(created.id, created)
      await tx.insert(projectWorkspace).values({ projectId, workspaceId: created.id })
    }
    for (const projectId of createdProjectIds) {
      const family = [...inserted.values()].filter((row) => row.projectId === projectId)
      const archivedAt = family.every((row) => row.archivedAt !== null)
        ? new Date(Math.max(...family.map((row) => row.archivedAt?.getTime() ?? 0)))
        : null
      if (archivedAt) await tx.update(project).set({ archivedAt }).where(eq(project.id, projectId))
    }
    return inputs.map((row) => {
      const created = inserted.get(row.id)
      if (!created) throw new Error('Workspace fixture insertion did not return a row')
      return created
    })
  })
}

/** Removes fixture environments and their now-empty Projects in the same transaction. */
export async function deleteWorkspaceFixture(
  database: FixtureDatabase | FixtureTransaction,
  condition: SQL | undefined
) {
  if (!condition) throw new Error('Workspace fixture deletion requires a predicate')
  await database.transaction(async (tx) => {
    const rows = await tx
      .select({ projectId: workspace.projectId })
      .from(workspace)
      .where(condition)
    await tx.delete(workspace).where(condition)
    if (rows.length)
      await tx.delete(project).where(
        and(
          inArray(
            project.id,
            rows.map((row) => row.projectId)
          ),
          notExists(
            tx.select({ one: sql`1` }).from(workspace).where(eq(workspace.projectId, project.id))
          )
        )
      )
  })
}
