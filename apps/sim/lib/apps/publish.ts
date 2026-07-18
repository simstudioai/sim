import { db } from '@sim/db'
import {
  appBuild,
  appDeploymentPin,
  appProject,
  appRelease,
  appReleaseAction,
  workflow,
  workflowDeploymentVersion,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getAppOriginStatus } from '@/lib/apps/origin'
import { assertReleaseArtifactAllowed } from '@/lib/apps/release-artifact-policy'
import { isProd } from '@/lib/core/config/env-flags'
import { isTurnstileConfigured } from '@/lib/core/security/turnstile'

const logger = createLogger('AppPublish')

type PublishEnvGate = { success: false; error: string; code: string }

/**
 * Production must not mint a public URL that cannot obtain an abuse token.
 * Local/dev may publish without Turnstile (abuse session issues tokens when unset).
 */
function assertPublishEnvironment(): PublishEnvGate | null {
  const origin = getAppOriginStatus()
  if (!origin.enabled) {
    return { success: false, error: origin.reason, code: 'APPS_ORIGIN_DISABLED' }
  }
  if (isProd && !isTurnstileConfigured()) {
    return {
      success: false,
      error:
        'Cannot publish in production without Turnstile. Configure TURNSTILE_SECRET_KEY (and the apps-host widget) before making an app current.',
      code: 'TURNSTILE_NOT_CONFIGURED',
    }
  }
  return null
}

export const MISSING_VERSION_PUBLISH_ERROR =
  'The workflow version this release was bound to no longer exists; rebind and rebuild.'

export type PublishResult =
  | { success: true; releaseId: string }
  | { success: false; error: string; code?: string }

export type RevokeResult =
  | {
      success: true
      clearedPointer: boolean
      event: {
        type: 'app.release.revoked'
        payload: { projectId: string; releaseId: string; reason: 'manual' }
      }
    }
  | { success: false; error: string }

export type RollbackResult =
  | { success: true; publishedReleaseId: string; revokedVacated: boolean }
  | { success: false; error: string; code?: string }

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

type ReleaseActionRow = {
  workflowId: string
  deploymentVersionId: string
}

/**
 * Pointer-only release model:
 * - Only `publishedReleaseId` is callable.
 * - Publishing / making-current always vacates the previous current (`revokedReason: vacated`).
 * - Explicit revoke uses `revokedReason: manual` and cannot be reactivated via rollback.
 */

async function insertPinsForRelease(
  tx: Tx,
  params: {
    projectId: string
    releaseId: string
    actions: ReleaseActionRow[]
  }
) {
  const pinKeys = new Map<string, { workflowId: string; deploymentVersionId: string }>()
  for (const action of params.actions) {
    pinKeys.set(`${action.workflowId}:${action.deploymentVersionId}`, {
      workflowId: action.workflowId,
      deploymentVersionId: action.deploymentVersionId,
    })
  }

  for (const pin of pinKeys.values()) {
    await tx.insert(appDeploymentPin).values({
      id: generateId(),
      kind: 'release',
      projectId: params.projectId,
      releaseId: params.releaseId,
      previewSessionId: null,
      revisionId: null,
      workflowId: pin.workflowId,
      deploymentVersionId: pin.deploymentVersionId,
      expiresAt: null,
      sessionStartedAt: null,
    })
  }
}

async function revokeReleaseInTx(
  tx: Tx,
  params: {
    projectId: string
    releaseId: string
    now: Date
    reason: 'vacated' | 'manual'
  }
) {
  const updated = await tx
    .update(appRelease)
    .set({
      state: 'revoked',
      revokedAt: params.now,
      revokedReason: params.reason,
    })
    .where(
      and(
        eq(appRelease.id, params.releaseId),
        eq(appRelease.projectId, params.projectId),
        eq(appRelease.state, 'published')
      )
    )
    .returning({ id: appRelease.id })

  // Only drop pins when the release actually transitioned published → revoked.
  if (updated.length === 0) return

  await tx.delete(appDeploymentPin).where(eq(appDeploymentPin.releaseId, params.releaseId))
}

/**
 * Shared publish-grade checks for prepare→publish and vacated→make-current.
 */
export async function validateReleaseActionsForActivation(
  tx: Tx,
  params: {
    workspaceId: string
    actions: ReleaseActionRow[]
  }
): Promise<{ ok: true } | { ok: false; error: string; code: string }> {
  const { workspaceId, actions } = params
  if (actions.length === 0) {
    return { ok: false, error: 'Release has no actions', code: 'EMPTY_RELEASE' }
  }

  const versionIds = [...new Set(actions.map((a) => a.deploymentVersionId))]
  const existing = await tx
    .select({
      id: workflowDeploymentVersion.id,
      workflowId: workflowDeploymentVersion.workflowId,
    })
    .from(workflowDeploymentVersion)
    .where(inArray(workflowDeploymentVersion.id, versionIds))

  if (existing.length !== versionIds.length) {
    return {
      ok: false,
      error: MISSING_VERSION_PUBLISH_ERROR,
      code: 'DEPLOYMENT_VERSION_MISSING',
    }
  }

  const workflowIds = [...new Set(actions.map((a) => a.workflowId))]
  const workflows = await tx
    .select({
      id: workflow.id,
      workspaceId: workflow.workspaceId,
      archivedAt: workflow.archivedAt,
    })
    .from(workflow)
    .where(inArray(workflow.id, workflowIds))

  if (workflows.length !== workflowIds.length) {
    return {
      ok: false,
      error: MISSING_VERSION_PUBLISH_ERROR,
      code: 'DEPLOYMENT_VERSION_MISSING',
    }
  }

  if (workflows.some((w) => w.workspaceId !== workspaceId || w.archivedAt)) {
    return {
      ok: false,
      error: 'Release actions reference workflows outside this workspace or archived workflows',
      code: 'WORKSPACE_MISMATCH',
    }
  }

  const versionById = new Map(existing.map((v) => [v.id, v.workflowId]))
  for (const action of actions) {
    if (versionById.get(action.deploymentVersionId) !== action.workflowId) {
      return {
        ok: false,
        error: MISSING_VERSION_PUBLISH_ERROR,
        code: 'DEPLOYMENT_VERSION_MISSING',
      }
    }
  }

  return { ok: true }
}

/**
 * Atomically: validate prepared → vacate previous current → publish + pins → set pointer.
 */
export async function publishPreparedRelease(params: {
  projectId: string
  releaseId: string
  expectedVersion?: number
}): Promise<PublishResult> {
  const { projectId, releaseId } = params

  const envGate = assertPublishEnvironment()
  if (envGate) return envGate

  try {
    return await db.transaction(async (tx) => {
      const [project] = await tx
        .select()
        .from(appProject)
        .where(and(eq(appProject.id, projectId), isNull(appProject.archivedAt)))
        .for('update')
        .limit(1)

      if (!project) {
        return { success: false as const, error: 'App project not found', code: 'NOT_FOUND' }
      }

      if (params.expectedVersion !== undefined && project.version !== params.expectedVersion) {
        return { success: false as const, error: 'Project version conflict', code: 'CONFLICT' }
      }

      const [release] = await tx
        .select()
        .from(appRelease)
        .where(and(eq(appRelease.id, releaseId), eq(appRelease.projectId, projectId)))
        .for('update')
        .limit(1)

      if (!release) {
        return { success: false as const, error: 'Release not found', code: 'NOT_FOUND' }
      }
      if (release.state !== 'prepared') {
        return {
          success: false as const,
          error: 'Only prepared releases can be published',
          code: 'INVALID_STATE',
        }
      }

      const buildMeta = release.buildId
        ? await tx
            .select({
              buildImageDigest: appBuild.buildImageDigest,
              diagnostics: appBuild.diagnostics,
            })
            .from(appBuild)
            .where(eq(appBuild.id, release.buildId))
            .limit(1)
            .then((rows) => rows[0])
        : undefined
      const buildMode =
        buildMeta && typeof buildMeta.diagnostics === 'object' && buildMeta.diagnostics
          ? ((buildMeta.diagnostics as { mode?: string }).mode ?? null)
          : null

      const artifactPolicy = await assertReleaseArtifactAllowed(release.artifactManifestHash, {
        buildImageDigest: buildMeta?.buildImageDigest,
        buildMode,
      })
      if (!artifactPolicy.ok) {
        return {
          success: false as const,
          error: artifactPolicy.error,
          code: artifactPolicy.code,
        }
      }

      const actions = await tx
        .select()
        .from(appReleaseAction)
        .where(eq(appReleaseAction.releaseId, releaseId))

      const validation = await validateReleaseActionsForActivation(tx, {
        workspaceId: project.workspaceId,
        actions,
      })
      if (!validation.ok) {
        return {
          success: false as const,
          error: validation.error,
          code: validation.code,
        }
      }

      const now = new Date()

      if (project.publishedReleaseId && project.publishedReleaseId !== releaseId) {
        await revokeReleaseInTx(tx, {
          projectId,
          releaseId: project.publishedReleaseId,
          now,
          reason: 'vacated',
        })
      }

      await tx
        .update(appRelease)
        .set({
          state: 'published',
          publishedAt: now,
          revokedAt: null,
          revokedReason: null,
        })
        .where(eq(appRelease.id, releaseId))

      await insertPinsForRelease(tx, { projectId, releaseId, actions })

      await tx
        .update(appProject)
        .set({
          publishedReleaseId: releaseId,
          version: sql`${appProject.version} + 1`,
          updatedAt: now,
        })
        .where(eq(appProject.id, projectId))

      logger.info('Published app release', { projectId, releaseId })
      return { success: true as const, releaseId }
    })
  } catch (error) {
    const cause =
      error && typeof error === 'object' && 'cause' in error
        ? (error as { cause?: unknown }).cause
        : undefined
    const detail =
      (cause instanceof Error && cause.message) ||
      (error instanceof Error && error.message) ||
      'Failed to publish release'
    logger.error('publishPreparedRelease failed', { error, projectId, releaseId })
    return { success: false, error: detail }
  }
}

/**
 * Explicit kill-switch revoke (`revokedReason: manual`). Clears pointer if current.
 * Manually revoked releases cannot be reactivated via rollback.
 */
export async function revokeRelease(params: {
  projectId: string
  releaseId: string
}): Promise<RevokeResult> {
  const { projectId, releaseId } = params

  try {
    return await db.transaction(async (tx) => {
      const [project] = await tx
        .select()
        .from(appProject)
        .where(eq(appProject.id, projectId))
        .for('update')
        .limit(1)

      if (!project) {
        return { success: false as const, error: 'App project not found' }
      }

      const [release] = await tx
        .select()
        .from(appRelease)
        .where(and(eq(appRelease.id, releaseId), eq(appRelease.projectId, projectId)))
        .for('update')
        .limit(1)

      if (!release) {
        return { success: false as const, error: 'Release not found' }
      }
      if (release.state !== 'published') {
        return { success: false as const, error: 'Only published releases can be revoked' }
      }

      const now = new Date()
      await revokeReleaseInTx(tx, { projectId, releaseId, now, reason: 'manual' })

      const clearedPointer = project.publishedReleaseId === releaseId
      if (clearedPointer) {
        await tx
          .update(appProject)
          .set({
            publishedReleaseId: null,
            version: sql`${appProject.version} + 1`,
            updatedAt: now,
          })
          .where(eq(appProject.id, projectId))
      } else {
        await tx
          .update(appProject)
          .set({ version: sql`${appProject.version} + 1`, updatedAt: now })
          .where(eq(appProject.id, projectId))
      }

      return {
        success: true as const,
        clearedPointer,
        event: {
          type: 'app.release.revoked' as const,
          payload: { projectId, releaseId, reason: 'manual' as const },
        },
      }
    })
  } catch (error) {
    logger.error('revokeRelease failed', { error, projectId, releaseId })
    return { success: false, error: 'Failed to revoke release' }
  }
}

/**
 * Make a vacated historical release current again (pointer-only rollback).
 * Manually revoked releases are rejected — prepare+publish a new release instead.
 */
export async function rollbackPublishedRelease(params: {
  projectId: string
  targetReleaseId: string
}): Promise<RollbackResult> {
  const { projectId, targetReleaseId } = params

  const envGate = assertPublishEnvironment()
  if (envGate) return envGate

  try {
    return await db.transaction(async (tx) => {
      const [project] = await tx
        .select()
        .from(appProject)
        .where(and(eq(appProject.id, projectId), isNull(appProject.archivedAt)))
        .for('update')
        .limit(1)

      if (!project) {
        return { success: false as const, error: 'App project not found' }
      }

      const [target] = await tx
        .select()
        .from(appRelease)
        .where(and(eq(appRelease.id, targetReleaseId), eq(appRelease.projectId, projectId)))
        .for('update')
        .limit(1)

      if (!target) {
        return { success: false as const, error: 'Target release not found' }
      }

      if (project.publishedReleaseId === targetReleaseId && target.state === 'published') {
        return {
          success: true as const,
          publishedReleaseId: targetReleaseId,
          revokedVacated: false,
        }
      }

      if (target.state === 'published') {
        return {
          success: false as const,
          error:
            'Target is published but not current; revoke or publish a prepared release instead',
          code: 'INVALID_STATE',
        }
      }

      if (target.state !== 'revoked' || target.revokedReason !== 'vacated') {
        return {
          success: false as const,
          error:
            'Only releases vacated by a later publish can be made current. Manually revoked releases stay dead — prepare and publish a new release from the same revision.',
          code: 'MANUAL_REVOKE_NOT_REACTIVATABLE',
        }
      }

      const targetBuildMeta = target.buildId
        ? await tx
            .select({
              buildImageDigest: appBuild.buildImageDigest,
              diagnostics: appBuild.diagnostics,
            })
            .from(appBuild)
            .where(eq(appBuild.id, target.buildId))
            .limit(1)
            .then((rows) => rows[0])
        : undefined
      const targetBuildMode =
        targetBuildMeta &&
        typeof targetBuildMeta.diagnostics === 'object' &&
        targetBuildMeta.diagnostics
          ? ((targetBuildMeta.diagnostics as { mode?: string }).mode ?? null)
          : null

      const artifactPolicy = await assertReleaseArtifactAllowed(target.artifactManifestHash, {
        buildImageDigest: targetBuildMeta?.buildImageDigest,
        buildMode: targetBuildMode,
      })
      if (!artifactPolicy.ok) {
        return {
          success: false as const,
          error: artifactPolicy.error,
          code: artifactPolicy.code,
        }
      }

      const actions = await tx
        .select()
        .from(appReleaseAction)
        .where(eq(appReleaseAction.releaseId, targetReleaseId))

      const validation = await validateReleaseActionsForActivation(tx, {
        workspaceId: project.workspaceId,
        actions,
      })
      if (!validation.ok) {
        return {
          success: false as const,
          error: validation.error,
          code: validation.code,
        }
      }

      const vacatedId = project.publishedReleaseId
      const now = new Date()
      let revokedVacated = false

      if (vacatedId && vacatedId !== targetReleaseId) {
        await revokeReleaseInTx(tx, {
          projectId,
          releaseId: vacatedId,
          now,
          reason: 'vacated',
        })
        revokedVacated = true
      }

      await tx.delete(appDeploymentPin).where(eq(appDeploymentPin.releaseId, targetReleaseId))
      await tx
        .update(appRelease)
        .set({
          state: 'published',
          publishedAt: target.publishedAt ?? now,
          revokedAt: null,
          revokedReason: null,
        })
        .where(eq(appRelease.id, targetReleaseId))
      await insertPinsForRelease(tx, { projectId, releaseId: targetReleaseId, actions })

      await tx
        .update(appProject)
        .set({
          publishedReleaseId: targetReleaseId,
          version: sql`${appProject.version} + 1`,
          updatedAt: now,
        })
        .where(eq(appProject.id, projectId))

      return {
        success: true as const,
        publishedReleaseId: targetReleaseId,
        revokedVacated,
      }
    })
  } catch (error) {
    logger.error('rollbackPublishedRelease failed', { error, projectId, targetReleaseId })
    return { success: false, error: 'Failed to rollback release' }
  }
}
