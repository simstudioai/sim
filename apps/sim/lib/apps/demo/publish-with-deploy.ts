import { db } from '@sim/db'
import {
  appBuild,
  appProject,
  appRevisionAction,
  appSourceBlob,
  appSourceFile,
  appSourceRevision,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { buildBoundActionEntry } from '@/lib/apps/bind-actions'
import { buildProjectRevision } from '@/lib/apps/build/project-build'
import { isDraftDeploymentVersionId } from '@/lib/apps/draft-binding'
import type { AppActionManifestEntry } from '@/lib/apps/manifest'
import { assertAppPermission } from '@/lib/apps/permissions'
import { stopActivePreviewSessionsForProject } from '@/lib/apps/pins'
import { prepareProjectRelease } from '@/lib/apps/prepare-release'
import { publishPreparedRelease } from '@/lib/apps/publish'
import { createRevisionWithActions, restoreDraftRevisionPointer } from '@/lib/apps/revisions'
import { generateRequestId } from '@/lib/core/utils/request'
import { performFullDeploy } from '@/lib/workflows/orchestration/deploy'

const logger = createLogger('FullstackDemoPublishWithDeploy')

export type PublishWithDeployResult =
  | {
      ok: true
      releaseId: string
      revisionId: string
      buildId: string
      deployments: Array<{ workflowId: string; deploymentVersionId: string }>
    }
  | {
      ok: false
      error: string
      code: string
      status: number
      /** Partial backend deployments already completed (acceptable for demo retry). */
      partialDeployments?: Array<{ workflowId: string; deploymentVersionId: string }>
    }

async function loadRevisionFiles(
  projectId: string,
  revisionId: string
): Promise<Record<string, string>> {
  const [revision] = await db
    .select({ id: appSourceRevision.id })
    .from(appSourceRevision)
    .where(and(eq(appSourceRevision.id, revisionId), eq(appSourceRevision.projectId, projectId)))
    .limit(1)
  if (!revision) throw new Error('Revision not found')

  const fileRows = await db
    .select({ path: appSourceFile.path, content: appSourceBlob.content })
    .from(appSourceFile)
    .innerJoin(appSourceBlob, eq(appSourceFile.contentHash, appSourceBlob.hash))
    .where(eq(appSourceFile.revisionId, revisionId))

  return Object.fromEntries(fileRows.map((row) => [row.path, row.content]))
}

/**
 * Deploy every draft-bound workflow, rebind to deployment versions, rebuild,
 * prepare a release, then publish the App pointer. Fails before changing the
 * public pointer if any step after deploy collection fails.
 */
export async function publishProjectWithDeploy(params: {
  projectId: string
  userId: string
  expectedVersion?: number
}): Promise<PublishWithDeployResult> {
  const [project] = await db
    .select()
    .from(appProject)
    .where(and(eq(appProject.id, params.projectId), isNull(appProject.archivedAt)))
    .limit(1)

  if (!project) {
    return { ok: false, error: 'Project not found', code: 'NOT_FOUND', status: 404 }
  }

  const permission = await assertAppPermission(params.userId, project.workspaceId, 'publish')
  if (!permission.ok) {
    return {
      ok: false,
      error: permission.message,
      code: 'PERMISSION_DENIED',
      status: permission.status,
    }
  }

  if (!project.draftRevisionId) {
    return {
      ok: false,
      error: 'App has no draft revision',
      code: 'NO_DRAFT',
      status: 400,
    }
  }

  if (typeof params.expectedVersion === 'number' && params.expectedVersion !== project.version) {
    return {
      ok: false,
      error: 'Project changed concurrently; reload and retry',
      code: 'CONFLICT',
      status: 409,
    }
  }

  const actions = await db
    .select()
    .from(appRevisionAction)
    .where(eq(appRevisionAction.revisionId, project.draftRevisionId))

  const draftActions = actions.filter((action) =>
    isDraftDeploymentVersionId(action.deploymentVersionId)
  )

  if (draftActions.length === 0) {
    return {
      ok: false,
      error: 'No draft bindings to deploy; use the normal prepare/publish flow',
      code: 'NO_DRAFT_BINDINGS',
      status: 400,
    }
  }

  await stopActivePreviewSessionsForProject(params.projectId)

  // Deduplicate by workflow ID — one deploy per workflow.
  const byWorkflow = new Map<string, (typeof draftActions)[number]>()
  for (const action of draftActions) {
    if (!byWorkflow.has(action.workflowId)) {
      byWorkflow.set(action.workflowId, action)
    }
  }

  const deployments: Array<{ workflowId: string; deploymentVersionId: string }> = []
  for (const [workflowId] of byWorkflow) {
    const requestId = generateRequestId()
    const deploy = await performFullDeploy({
      workflowId,
      userId: params.userId,
      actorId: params.userId,
      requestId,
    })
    if (!deploy.success || !deploy.deploymentVersionId) {
      return {
        ok: false,
        error: deploy.error || `Failed to deploy workflow ${workflowId}`,
        code: deploy.errorCode || 'DEPLOY_FAILED',
        status: 400,
        partialDeployments: deployments,
      }
    }
    deployments.push({
      workflowId,
      deploymentVersionId: deploy.deploymentVersionId,
    })
  }

  const versionByWorkflow = new Map(deployments.map((d) => [d.workflowId, d.deploymentVersionId]))

  const rebound: AppActionManifestEntry[] = []
  for (const action of actions) {
    const deploymentVersionId =
      versionByWorkflow.get(action.workflowId) || action.deploymentVersionId
    if (isDraftDeploymentVersionId(deploymentVersionId)) {
      return {
        ok: false,
        error: `Action ${action.actionId} still draft-bound after deploy`,
        code: 'REBIND_FAILED',
        status: 500,
        partialDeployments: deployments,
      }
    }

    const bound = await buildBoundActionEntry({
      workspaceId: project.workspaceId,
      request: {
        actionId: action.actionId,
        workflowId: action.workflowId,
        deploymentVersionId,
        outputAllowlist: (
          action.outputAllowlist as Array<{ key: string; blockId: string; path: string }>
        ).map((o) => ({ key: o.key, blockId: o.blockId, path: o.path })),
        executionPolicy: 'sync',
      },
    })
    if (!bound.ok) {
      return {
        ok: false,
        error: bound.error,
        code: bound.code || 'REBIND_FAILED',
        status: 400,
        partialDeployments: deployments,
      }
    }
    rebound.push(bound.action)
  }

  let files: Record<string, string>
  try {
    files = await loadRevisionFiles(params.projectId, project.draftRevisionId)
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to load revision files',
      code: 'REVISION_FILES',
      status: 500,
      partialDeployments: deployments,
    }
  }

  let revisionId: string
  try {
    const created = await createRevisionWithActions({
      projectId: params.projectId,
      userId: params.userId,
      actions: rebound,
      files,
      parentRevisionId: project.draftRevisionId,
      expectedRevisionId: project.draftRevisionId,
    })
    revisionId = created.revisionId
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to create rebound revision',
      code: 'REVISION_FAILED',
      status: 500,
      partialDeployments: deployments,
    }
  }

  const build = await buildProjectRevision({
    projectId: params.projectId,
    revisionId,
    userId: params.userId,
  })
  if (!build.ok) {
    await restoreDraftRevisionPointer({
      projectId: params.projectId,
      failedRevisionId: revisionId,
      parentRevisionId: project.draftRevisionId,
    })
    return {
      ok: false,
      error: build.error,
      code: 'BUILD_FAILED',
      status: 400,
      partialDeployments: deployments,
    }
  }

  const prepared = await prepareProjectRelease({
    projectId: params.projectId,
    revisionId,
    buildId: build.buildId,
    userId: params.userId,
  })
  if (!prepared.ok) {
    return {
      ok: false,
      error: prepared.error,
      code: prepared.code,
      status: prepared.status,
      partialDeployments: deployments,
    }
  }

  // Re-read project version after mutate-heavy path for pointer publish.
  const [freshProject] = await db
    .select({ version: appProject.version })
    .from(appProject)
    .where(eq(appProject.id, params.projectId))
    .limit(1)

  const published = await publishPreparedRelease({
    projectId: params.projectId,
    releaseId: prepared.releaseId,
    expectedVersion: freshProject?.version,
  })

  if (!published.success) {
    logger.error('Pointer publish failed after prepare', {
      projectId: params.projectId,
      error: published.error,
    })
    return {
      ok: false,
      error: published.error,
      code: published.code || 'PUBLISH_FAILED',
      status: 400,
      partialDeployments: deployments,
    }
  }

  return {
    ok: true,
    releaseId: published.releaseId,
    revisionId,
    buildId: build.buildId,
    deployments,
  }
}

/** Latest succeeded build for a revision (helper for callers). */
export async function getLatestSucceededBuildId(
  projectId: string,
  revisionId: string
): Promise<string | null> {
  const [row] = await db
    .select({ id: appBuild.id })
    .from(appBuild)
    .where(
      and(
        eq(appBuild.projectId, projectId),
        eq(appBuild.revisionId, revisionId),
        eq(appBuild.status, 'succeeded')
      )
    )
    .orderBy(desc(appBuild.createdAt))
    .limit(1)
  return row?.id ?? null
}
