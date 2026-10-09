import { db } from '@sim/db'
import {
  changelogChange,
  changelogRelease,
  copilotChats,
  workflow,
  workflowDeploymentVersion,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, asc, desc, eq, inArray, lt, or, sql } from 'drizzle-orm'
import type { ReleaseVersion } from '@/lib/changelog/version'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'

export type ChangelogReleaseRow = typeof changelogRelease.$inferSelect

export interface ChangelogChangeInput {
  text: string
  workflowId?: string
  deploymentVersionId?: string
  chatId?: string
}

export interface ChangelogChangeView {
  id: string
  text: string
  workflowId: string | null
  workflowName: string | null
  deploymentVersionId: string | null
  deploymentVersion: number | null
  chatId: string | null
}

export interface ReleaseCursor {
  publishedAt: Date
  id: string
}

/** The workspace's highest version by number, not by publish date; labels can be edited. */
export async function getHighestReleaseVersion(
  workspaceId: string,
  executor: DbOrTx = db
): Promise<ReleaseVersion | null> {
  const [row] = await executor
    .select({
      major: changelogRelease.versionMajor,
      minor: changelogRelease.versionMinor,
      patch: changelogRelease.versionPatch,
    })
    .from(changelogRelease)
    .where(eq(changelogRelease.workspaceId, workspaceId))
    .orderBy(
      desc(changelogRelease.versionMajor),
      desc(changelogRelease.versionMinor),
      desc(changelogRelease.versionPatch)
    )
    .limit(1)
  return row ?? null
}

export async function insertReleaseInTx(
  tx: DbTransaction,
  values: typeof changelogRelease.$inferInsert,
  changes: ChangelogChangeInput[]
): Promise<ChangelogReleaseRow> {
  const [row] = await tx.insert(changelogRelease).values(values).returning()
  await insertChanges(tx, row.id, changes)
  return row
}

async function insertChanges(
  tx: DbTransaction,
  releaseId: string,
  changes: ChangelogChangeInput[]
): Promise<void> {
  if (changes.length === 0) return
  await tx.insert(changelogChange).values(
    changes.map((change, position) => ({
      id: generateId(),
      releaseId,
      position,
      text: change.text,
      workflowId: change.workflowId ?? null,
      deploymentVersionId: change.deploymentVersionId ?? null,
      chatId: change.chatId ?? null,
    }))
  )
}

export async function getRelease(
  workspaceId: string,
  releaseId: string,
  executor: DbOrTx = db
): Promise<ChangelogReleaseRow | null> {
  const [row] = await executor
    .select()
    .from(changelogRelease)
    .where(and(eq(changelogRelease.id, releaseId), eq(changelogRelease.workspaceId, workspaceId)))
    .limit(1)
  return row ?? null
}

export async function getReleaseByBodyFileId(
  bodyFileId: string,
  executor: DbOrTx = db
): Promise<ChangelogReleaseRow | null> {
  const [row] = await executor
    .select()
    .from(changelogRelease)
    .where(eq(changelogRelease.bodyFileId, bodyFileId))
    .limit(1)
  return row ?? null
}

/** Newest first; the cursor is the last row of the previous page. */
export async function listReleases(
  workspaceId: string,
  limit: number,
  cursor: ReleaseCursor | null
): Promise<ChangelogReleaseRow[]> {
  return db
    .select()
    .from(changelogRelease)
    .where(
      and(
        eq(changelogRelease.workspaceId, workspaceId),
        cursor
          ? or(
              lt(changelogRelease.publishedAt, cursor.publishedAt),
              and(
                eq(changelogRelease.publishedAt, cursor.publishedAt),
                lt(changelogRelease.id, cursor.id)
              )
            )
          : undefined
      )
    )
    .orderBy(desc(changelogRelease.publishedAt), desc(changelogRelease.id))
    .limit(limit)
}

export async function listChangesByRelease(
  releaseIds: string[],
  executor: DbOrTx = db
): Promise<Map<string, ChangelogChangeView[]>> {
  const byRelease = new Map<string, ChangelogChangeView[]>()
  if (releaseIds.length === 0) return byRelease
  const rows = await executor
    .select({
      releaseId: changelogChange.releaseId,
      id: changelogChange.id,
      text: changelogChange.text,
      workflowId: changelogChange.workflowId,
      workflowName: workflow.name,
      deploymentVersionId: changelogChange.deploymentVersionId,
      deploymentVersion: workflowDeploymentVersion.version,
      chatId: changelogChange.chatId,
    })
    .from(changelogChange)
    .leftJoin(workflow, eq(workflow.id, changelogChange.workflowId))
    .leftJoin(
      workflowDeploymentVersion,
      eq(workflowDeploymentVersion.id, changelogChange.deploymentVersionId)
    )
    .where(inArray(changelogChange.releaseId, releaseIds))
    .orderBy(asc(changelogChange.releaseId), asc(changelogChange.position))
  for (const { releaseId, ...change } of rows) {
    const list = byRelease.get(releaseId) ?? []
    list.push(change)
    byRelease.set(releaseId, list)
  }
  return byRelease
}

export interface ReleaseFieldsUpdate {
  title?: string
  bumpReason?: string
  version?: ReleaseVersion
}

/**
 * Applies a field update, and replaces the changes when given, only while the revision still
 * matches; null when it does not. Returns the row with the changes of that same revision.
 */
export async function updateRelease(
  releaseId: string,
  expectedRevision: number,
  userId: string,
  fields: ReleaseFieldsUpdate,
  changes: ChangelogChangeInput[] | undefined
): Promise<{ row: ChangelogReleaseRow; changes: ChangelogChangeView[] } | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(changelogRelease)
      .set({
        ...(fields.title !== undefined ? { title: fields.title } : {}),
        ...(fields.bumpReason !== undefined ? { bumpReason: fields.bumpReason } : {}),
        ...(fields.version
          ? {
              versionMajor: fields.version.major,
              versionMinor: fields.version.minor,
              versionPatch: fields.version.patch,
            }
          : {}),
        updatedBy: userId,
        updatedAt: new Date(),
        revision: sql`${changelogRelease.revision} + 1`,
      })
      .where(
        and(eq(changelogRelease.id, releaseId), eq(changelogRelease.revision, expectedRevision))
      )
      .returning()
    if (!row) return null
    if (changes) {
      await tx.delete(changelogChange).where(eq(changelogChange.releaseId, releaseId))
      await insertChanges(tx, releaseId, changes)
    }
    const changesByRelease = await listChangesByRelease([releaseId], tx)
    return { row, changes: changesByRelease.get(releaseId) ?? [] }
  })
}

/** The referenced ids that do not belong to this workspace, so a change cannot point elsewhere. */
export async function findForeignChangeReferences(
  workspaceId: string,
  changes: ChangelogChangeInput[]
): Promise<string[]> {
  const workflowIds = [...new Set(changes.flatMap((c) => (c.workflowId ? [c.workflowId] : [])))]
  const chatIds = [...new Set(changes.flatMap((c) => (c.chatId ? [c.chatId] : [])))]
  const deployments = changes.flatMap((c) =>
    c.deploymentVersionId ? [{ id: c.deploymentVersionId, workflowId: c.workflowId }] : []
  )
  const [workflows, chats, versions] = await Promise.all([
    workflowIds.length
      ? db
          .select({ id: workflow.id })
          .from(workflow)
          .where(and(inArray(workflow.id, workflowIds), eq(workflow.workspaceId, workspaceId)))
      : [],
    chatIds.length
      ? db
          .select({ id: copilotChats.id })
          .from(copilotChats)
          .where(and(inArray(copilotChats.id, chatIds), eq(copilotChats.workspaceId, workspaceId)))
      : [],
    deployments.length
      ? db
          .select({
            id: workflowDeploymentVersion.id,
            workflowId: workflowDeploymentVersion.workflowId,
          })
          .from(workflowDeploymentVersion)
          .innerJoin(workflow, eq(workflow.id, workflowDeploymentVersion.workflowId))
          .where(
            and(
              inArray(
                workflowDeploymentVersion.id,
                deployments.map((d) => d.id)
              ),
              eq(workflow.workspaceId, workspaceId)
            )
          )
      : [],
  ])
  const knownWorkflows = new Set(workflows.map((w) => w.id))
  const knownChats = new Set(chats.map((c) => c.id))
  const versionWorkflow = new Map(versions.map((v) => [v.id, v.workflowId]))
  return [
    ...workflowIds.filter((id) => !knownWorkflows.has(id)).map((id) => `workflow ${id}`),
    ...chatIds.filter((id) => !knownChats.has(id)).map((id) => `chat ${id}`),
    ...deployments
      .filter((d) => {
        const owner = versionWorkflow.get(d.id)
        return owner === undefined || owner !== d.workflowId
      })
      .map((d) => `deployment version ${d.id}`),
  ]
}
