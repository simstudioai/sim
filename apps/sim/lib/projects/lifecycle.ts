import { project, workspace } from '@sim/db/schema'
import { asc, eq } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'
import { lockProject } from '@/lib/projects/membership'
import {
  archiveEnvironmentInTransaction,
  type EnvironmentArchiveEffects,
  finishEnvironmentArchive,
} from '@/lib/workspaces/lifecycle'

/** All durable archive state commits together; external notifications follow the commit. */
export async function archiveProjectInTransaction(
  tx: DbTransaction,
  projectId: string
): Promise<EnvironmentArchiveEffects[]> {
  await lockProject(tx, projectId)
  const [record] = await tx.select().from(project).where(eq(project.id, projectId))
  if (!record) throw new OrchestrationError('not_found', 'Project not found')
  const now = record.archivedAt ?? new Date()
  const environments = await tx
    .select({ id: workspace.id })
    .from(workspace)
    .where(eq(workspace.projectId, projectId))
    .orderBy(asc(workspace.id))
    .for('no key update')
  const effects: EnvironmentArchiveEffects[] = []
  for (const { id } of environments)
    effects.push(await archiveEnvironmentInTransaction(tx, id, now))
  await tx.update(project).set({ archivedAt: now, updatedAt: now }).where(eq(project.id, projectId))
  return effects
}

export async function finishProjectArchive(
  effects: EnvironmentArchiveEffects[],
  requestId: string
): Promise<void> {
  for (const environment of effects) await finishEnvironmentArchive(environment, requestId)
}
