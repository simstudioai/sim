import { db } from '@sim/db'
import {
  appBuild,
  appProject,
  appRelease,
  appReleaseAction,
  appRevisionAction,
  appSourceRevision,
  workflow,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull } from 'drizzle-orm'
import { getAppOriginStatus } from '@/lib/apps/origin'
import { assertAppPermission } from '@/lib/apps/permissions'

export type PrepareProjectReleaseResult =
  | { ok: true; releaseId: string }
  | { ok: false; error: string; code: string; status: number }

export async function prepareProjectRelease(params: {
  projectId: string
  revisionId: string
  buildId: string
  userId: string
}): Promise<PrepareProjectReleaseResult> {
  const origin = getAppOriginStatus()
  if (!origin.enabled) {
    return {
      ok: false,
      error: origin.reason,
      code: 'APPS_ORIGIN_MISCONFIGURED',
      status: 503,
    }
  }

  const [project] = await db
    .select()
    .from(appProject)
    .where(and(eq(appProject.id, params.projectId), isNull(appProject.archivedAt)))
    .limit(1)
  if (!project) return { ok: false, error: 'Project not found', code: 'NOT_FOUND', status: 404 }

  const permission = await assertAppPermission(params.userId, project.workspaceId, 'publish')
  if (!permission.ok) {
    return {
      ok: false,
      error: permission.message,
      code: 'PERMISSION_DENIED',
      status: permission.status,
    }
  }

  const [revision] = await db
    .select()
    .from(appSourceRevision)
    .where(
      and(
        eq(appSourceRevision.id, params.revisionId),
        eq(appSourceRevision.projectId, params.projectId)
      )
    )
    .limit(1)
  if (!revision) return { ok: false, error: 'Revision not found', code: 'NOT_FOUND', status: 404 }

  const [build] = await db
    .select()
    .from(appBuild)
    .where(
      and(
        eq(appBuild.id, params.buildId),
        eq(appBuild.projectId, params.projectId),
        eq(appBuild.revisionId, params.revisionId),
        eq(appBuild.status, 'succeeded')
      )
    )
    .limit(1)
  if (!build?.artifactManifestHash) {
    return {
      ok: false,
      error: 'Successful build not found for revision',
      code: 'BUILD_REQUIRED',
      status: 400,
    }
  }

  const actions = await db
    .select()
    .from(appRevisionAction)
    .where(eq(appRevisionAction.revisionId, params.revisionId))
  if (actions.length === 0) {
    return {
      ok: false,
      error: 'Revision has no bound actions',
      code: 'EMPTY_REVISION',
      status: 400,
    }
  }

  for (const action of actions) {
    const [wf] = await db
      .select({ id: workflow.id })
      .from(workflow)
      .where(
        and(
          eq(workflow.id, action.workflowId),
          eq(workflow.workspaceId, project.workspaceId),
          isNull(workflow.archivedAt)
        )
      )
      .limit(1)
    if (!wf) {
      return {
        ok: false,
        error: `Workflow ${action.workflowId} is not available in this workspace`,
        code: 'WORKFLOW_MISSING',
        status: 400,
      }
    }
  }

  const releaseId = generateId()
  await db.transaction(async (tx) => {
    await tx.insert(appRelease).values({
      id: releaseId,
      projectId: params.projectId,
      revisionId: params.revisionId,
      buildId: params.buildId,
      state: 'prepared',
      artifactManifestHash: build.artifactManifestHash!,
      templateVersion: revision.templateVersion,
      sdkVersion: revision.sdkVersion,
      createdBy: params.userId,
    })
    for (const action of actions) {
      await tx.insert(appReleaseAction).values({
        id: generateId(),
        releaseId,
        actionId: action.actionId,
        workflowId: action.workflowId,
        deploymentVersionId: action.deploymentVersionId,
        inputSchema: action.inputSchema,
        outputAllowlist: action.outputAllowlist,
        executionPolicy: action.executionPolicy,
        schemaHash: action.schemaHash,
      })
    }
  })
  return { ok: true, releaseId }
}
