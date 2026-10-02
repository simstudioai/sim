import type { db } from '@sim/db'
import { project, projectWorkspace, workspace } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, notExists, type SQL } from 'drizzle-orm'
import type { PgInsertValue } from 'drizzle-orm/pg-core'

type FixtureDatabase = typeof db
type FixtureTransaction = Parameters<Parameters<FixtureDatabase['transaction']>[0]>[0]
type WorkspaceRow = PgInsertValue<typeof workspace>

/** Seeds real environments with the Project membership required by the migrated schema. */
export async function insertWorkspaceFixture(
  database: FixtureDatabase | FixtureTransaction,
  values: WorkspaceRow | WorkspaceRow[]
) {
  return database.transaction(async (tx) => {
    const rows = await tx
      .insert(workspace)
      .values(Array.isArray(values) ? values : [values])
      .returning()
    for (const row of rows) {
      const [parent] = row.forkedFromWorkspaceId
        ? await tx
            .select()
            .from(projectWorkspace)
            .where(eq(projectWorkspace.workspaceId, row.forkedFromWorkspaceId))
        : []
      const projectId = parent?.projectId ?? generateId()
      if (!parent)
        await tx.insert(project).values({
          id: projectId,
          name: 'Fixture project',
          ownerId: row.ownerId,
          organizationId: row.organizationId,
          archivedAt: row.archivedAt,
        })
      await tx.insert(projectWorkspace).values({ projectId, workspaceId: row.id })
    }
    return rows
  })
}

/** Removes fixture environments and their now-empty Projects in the same transaction. */
export async function deleteWorkspaceFixture(
  database: FixtureDatabase | FixtureTransaction,
  condition: SQL | undefined
) {
  await database.transaction(async (tx) => {
    const rows = await tx
      .select({ projectId: projectWorkspace.projectId })
      .from(workspace)
      .innerJoin(projectWorkspace, eq(projectWorkspace.workspaceId, workspace.id))
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
            tx.select().from(projectWorkspace).where(eq(projectWorkspace.projectId, project.id))
          )
        )
      )
  })
}
