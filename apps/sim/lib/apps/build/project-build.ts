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
import { generateId } from '@sim/utils/id'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { assertArtifactBundleReady } from '@/lib/apps/artifacts/store'
import {
  type AppBuildIdentity,
  buildIdentityMatches,
  currentE2BBuildIdentity,
} from '@/lib/apps/build/build-identity'
import { runAppBuild } from '@/lib/apps/build/e2b-app-build'
import { finalizeStaleRunningBuilds } from '@/lib/apps/build/stale-builds'
import { assertBuildQuota } from '@/lib/apps/governance'
import type { AppActionManifestEntry } from '@/lib/apps/manifest'
import { assertAppPermission } from '@/lib/apps/permissions'
import { assertCurrentDraftRevision, DraftRevisionConflictError } from '@/lib/apps/revisions'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import { isProd } from '@/lib/core/config/env-flags'

const logger = createLogger('ProjectAppBuild')

export type ProjectBuildResult =
  | {
      ok: true
      buildId: string
      artifactManifestHash: string
      buildImageDigest: string
      diagnostics: Record<string, unknown>
      reused?: boolean
    }
  | { ok: false; error: string; code: string; status: number }

export async function buildProjectRevision(params: {
  projectId: string
  revisionId: string
  userId: string
  expectedRevisionId?: string
}): Promise<ProjectBuildResult> {
  const { projectId, revisionId, userId } = params
  const [project] = await db
    .select()
    .from(appProject)
    .where(and(eq(appProject.id, projectId), isNull(appProject.archivedAt)))
    .limit(1)
  if (!project) return { ok: false, error: 'Project not found', code: 'NOT_FOUND', status: 404 }

  const permission = await assertAppPermission(userId, project.workspaceId, 'edit')
  if (!permission.ok) {
    return {
      ok: false,
      error: permission.message,
      code: 'PERMISSION_DENIED',
      status: permission.status,
    }
  }

  try {
    assertCurrentDraftRevision({
      currentDraftRevisionId: project.draftRevisionId,
      revisionId,
      expectedRevisionId: params.expectedRevisionId,
    })
  } catch (error) {
    if (error instanceof DraftRevisionConflictError) {
      return { ok: false, error: error.message, code: error.code, status: error.status }
    }
    throw error
  }

  const [revision] = await db
    .select({ id: appSourceRevision.id })
    .from(appSourceRevision)
    .where(and(eq(appSourceRevision.id, revisionId), eq(appSourceRevision.projectId, projectId)))
    .limit(1)
  if (!revision) return { ok: false, error: 'Revision not found', code: 'NOT_FOUND', status: 404 }

  await finalizeStaleRunningBuilds()
  const [prior] = await db
    .select()
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

  let currentIdentity: AppBuildIdentity | null = null
  const localViteEnabled = isTruthy(getEnv('APPS_ALLOW_LOCAL_VITE_BUILDS'))
  const fixtureEnabled = isTruthy(getEnv('APPS_ALLOW_FIXTURE_BUILDS'))
  const e2bConfigured =
    isTruthy(getEnv('E2B_ENABLED') || getEnv('NEXT_PUBLIC_E2B_ENABLED')) &&
    Boolean((getEnv('E2B_APP_BUILD_TEMPLATE_ID') || '').trim())
  if (isProd || (!localViteEnabled && !fixtureEnabled && e2bConfigured)) {
    const digest = (getEnv('E2B_APP_BUILD_IMAGE_DIGEST') || '').trim()
    if (digest.startsWith('e2b-build:')) currentIdentity = currentE2BBuildIdentity(digest)
  } else if (localViteEnabled) {
    const { currentLocalViteBuildIdentity } = await import('@/lib/apps/build/local-toolchain')
    currentIdentity = currentLocalViteBuildIdentity()
  }

  if (
    currentIdentity &&
    prior?.artifactManifestHash?.startsWith('sha256:') &&
    buildIdentityMatches(
      { diagnostics: prior.diagnostics, buildImageDigest: prior.buildImageDigest },
      currentIdentity
    )
  ) {
    const ready = await assertArtifactBundleReady(prior.artifactManifestHash)
    if (ready.ok) {
      return {
        ok: true,
        buildId: prior.id,
        artifactManifestHash: prior.artifactManifestHash,
        buildImageDigest: prior.buildImageDigest!,
        diagnostics: { ...(prior.diagnostics as Record<string, unknown>), reused: true },
        reused: true,
      }
    }
    logger.warn('Prior build artifact missing; rebuilding', {
      projectId,
      revisionId,
      buildId: prior.id,
    })
  }

  const quota = await assertBuildQuota(project.workspaceId)
  if (!quota.ok) {
    return { ok: false, error: quota.error, code: 'BUILD_QUOTA_EXCEEDED', status: 429 }
  }

  const files = await db
    .select({ path: appSourceFile.path, content: appSourceBlob.content })
    .from(appSourceFile)
    .innerJoin(appSourceBlob, eq(appSourceFile.contentHash, appSourceBlob.hash))
    .where(eq(appSourceFile.revisionId, revisionId))
  const fileMap = Object.fromEntries(files.map((file) => [file.path, file.content]))

  const actionRows = await db
    .select()
    .from(appRevisionAction)
    .where(eq(appRevisionAction.revisionId, revisionId))
  const actions: AppActionManifestEntry[] = actionRows.map((row) => ({
    actionId: row.actionId,
    workflowId: row.workflowId,
    deploymentVersionId: row.deploymentVersionId,
    inputSchema: row.inputSchema as AppActionManifestEntry['inputSchema'],
    outputAllowlist: row.outputAllowlist as AppActionManifestEntry['outputAllowlist'],
    executionPolicy: (row.executionPolicy as 'sync' | 'async') || 'sync',
    readOnly: row.readOnly,
    schemaHash: row.schemaHash,
  }))

  const buildId = generateId()
  try {
    await db.transaction(async (tx) => {
      const [lockedProject] = await tx
        .select({ id: appProject.id, draftRevisionId: appProject.draftRevisionId })
        .from(appProject)
        .where(eq(appProject.id, projectId))
        .for('update')
        .limit(1)
      if (!lockedProject) throw new Error('PROJECT_NOT_FOUND')
      assertCurrentDraftRevision({
        currentDraftRevisionId: lockedProject.draftRevisionId,
        revisionId,
        expectedRevisionId: params.expectedRevisionId,
      })
      const [running] = await tx
        .select({ id: appBuild.id })
        .from(appBuild)
        .where(and(eq(appBuild.projectId, projectId), eq(appBuild.status, 'running')))
        .limit(1)
      if (running) throw new Error('BUILD_IN_PROGRESS')
      await tx.insert(appBuild).values({
        id: buildId,
        projectId,
        revisionId,
        status: 'running',
      })
    })
  } catch (error) {
    if (error instanceof DraftRevisionConflictError) {
      return { ok: false, error: error.message, code: error.code, status: error.status }
    }
    if (error instanceof Error && error.message === 'PROJECT_NOT_FOUND') {
      return { ok: false, error: 'Project not found', code: 'NOT_FOUND', status: 404 }
    }
    if (error instanceof Error && error.message === 'BUILD_IN_PROGRESS') {
      return {
        ok: false,
        error: 'A build is already running for this project',
        code: 'BUILD_IN_PROGRESS',
        status: 409,
      }
    }
    throw error
  }

  try {
    const result = await runAppBuild({ projectId, revisionId, files: fileMap, actions })
    if (!result.success) {
      await db
        .update(appBuild)
        .set({
          status: 'failed',
          diagnostics: result.diagnostics || { error: result.error },
          finishedAt: new Date(),
        })
        .where(eq(appBuild.id, buildId))
      return { ok: false, error: result.error, code: 'BUILD_FAILED', status: 400 }
    }

    const diagnostics = { ...(result.diagnostics || {}) }
    await db
      .update(appBuild)
      .set({
        status: 'succeeded',
        artifactManifestHash: result.artifactManifestHash,
        buildImageDigest: result.buildImageDigest,
        diagnostics,
        finishedAt: new Date(),
      })
      .where(eq(appBuild.id, buildId))

    return {
      ok: true,
      buildId,
      artifactManifestHash: result.artifactManifestHash,
      buildImageDigest: result.buildImageDigest,
      diagnostics,
    }
  } catch (error) {
    logger.error('App build threw unexpectedly', { buildId, projectId, revisionId, error })
    await db
      .update(appBuild)
      .set({
        status: 'failed',
        diagnostics: {
          error: error instanceof Error ? error.message : 'Build failed unexpectedly',
        },
        finishedAt: new Date(),
      })
      .where(eq(appBuild.id, buildId))
    return {
      ok: false,
      error: 'Build failed unexpectedly',
      code: 'BUILD_FAILED',
      status: 500,
    }
  }
}
