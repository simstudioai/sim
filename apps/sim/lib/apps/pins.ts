import { db } from '@sim/db'
import {
  appBuild,
  appDeploymentPin,
  appPreviewSession,
  appProject,
  appRelease,
  appRevisionAction,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, desc, eq, inArray, isNotNull, lt, or, sql } from 'drizzle-orm'
import {
  assertArtifactBundleReady,
  withArtifactStoreMutationLock,
} from '@/lib/apps/artifacts/store'
import { isDraftDeploymentVersionId } from '@/lib/apps/draft-binding'
import {
  isPreviewSessionPastHardMax,
  mintPreviewChannelNonce,
  PREVIEW_SESSION_HARD_MAX_MS,
  previewPinExpiresAt,
  previewPinExpiresAtForSession,
} from '@/lib/apps/preview-ttl'

export type PinnedAppSummary = {
  projectId: string
  publicId: string
  name: string
  releaseIds: string[]
}

/** Apps with callable release pins on any of the given workflow ids. */
export async function listAppsPinnedToWorkflows(
  workflowIds: string[]
): Promise<PinnedAppSummary[]> {
  if (workflowIds.length === 0) return []

  const rows = await db
    .select({
      projectId: appProject.id,
      publicId: appProject.publicId,
      name: appProject.name,
      releaseId: appDeploymentPin.releaseId,
    })
    .from(appDeploymentPin)
    .innerJoin(appProject, eq(appDeploymentPin.projectId, appProject.id))
    .where(
      and(
        eq(appDeploymentPin.kind, 'release'),
        inArray(appDeploymentPin.workflowId, workflowIds),
        isNotNull(appDeploymentPin.releaseId)
      )
    )

  const byProject = new Map<string, PinnedAppSummary>()
  for (const row of rows) {
    if (!row.releaseId) continue
    const existing = byProject.get(row.projectId)
    if (existing) {
      if (!existing.releaseIds.includes(row.releaseId)) {
        existing.releaseIds.push(row.releaseId)
      }
    } else {
      byProject.set(row.projectId, {
        projectId: row.projectId,
        publicId: row.publicId,
        name: row.name,
        releaseIds: [row.releaseId],
      })
    }
  }
  return [...byProject.values()]
}

/** Apps retaining workflow versions through either callable releases or active previews. */
export async function listAppsRetainingWorkflows(
  workflowIds: string[]
): Promise<PinnedAppSummary[]> {
  if (workflowIds.length === 0) return []

  const rows = await db
    .select({
      projectId: appProject.id,
      publicId: appProject.publicId,
      name: appProject.name,
      releaseId: appDeploymentPin.releaseId,
    })
    .from(appDeploymentPin)
    .innerJoin(appProject, eq(appDeploymentPin.projectId, appProject.id))
    .where(inArray(appDeploymentPin.workflowId, workflowIds))

  const byProject = new Map<string, PinnedAppSummary>()
  for (const row of rows) {
    const existing = byProject.get(row.projectId)
    if (existing) {
      if (row.releaseId && !existing.releaseIds.includes(row.releaseId)) {
        existing.releaseIds.push(row.releaseId)
      }
      continue
    }
    byProject.set(row.projectId, {
      projectId: row.projectId,
      publicId: row.publicId,
      name: row.name,
      releaseIds: row.releaseId ? [row.releaseId] : [],
    })
  }
  return [...byProject.values()]
}

export async function workflowHasAppDeploymentPins(workflowId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: appDeploymentPin.id })
    .from(appDeploymentPin)
    .where(eq(appDeploymentPin.workflowId, workflowId))
    .limit(1)
  return Boolean(row)
}

export async function deploymentVersionHasAppPins(deploymentVersionId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: appDeploymentPin.id })
    .from(appDeploymentPin)
    .where(eq(appDeploymentPin.deploymentVersionId, deploymentVersionId))
    .limit(1)
  return Boolean(row)
}

export async function activatePreviewPins(params: {
  projectId: string
  revisionId: string
  userId: string
}): Promise<{
  sessionId: string
  expiresAt: Date
  channelNonce: string
  buildId: string
  artifactManifestHash: string | null
  /** True when iframe should load the Vite artifact instead of the diagnostic shell. */
  artifactPreview: boolean
  event: {
    type: 'app.preview.ready'
    payload: {
      projectId: string
      revisionId: string
      sessionId: string
      buildId: string
    }
  }
}> {
  const startedAt = new Date()
  const expiresAt = previewPinExpiresAt(startedAt.getTime())
  const sessionId = generateId()
  const channelNonce = mintPreviewChannelNonce()

  const [build] = await db
    .select()
    .from(appBuild)
    .where(
      and(
        eq(appBuild.projectId, params.projectId),
        eq(appBuild.revisionId, params.revisionId),
        eq(appBuild.status, 'succeeded')
      )
    )
    .orderBy(desc(appBuild.createdAt))
    .limit(1)

  if (!build) {
    throw new Error('Build the revision before previewing')
  }

  const artifactManifestHash =
    build.artifactManifestHash?.startsWith('sha256:') && build.artifactManifestHash
      ? build.artifactManifestHash
      : null

  // Stop prior sessions + create the new one in one transaction so concurrent
  // activations cannot leave multiple live sessions for the same user×project.
  // Project row lock serializes activators; partial unique index is the hard stop.
  try {
    const activate = async () => {
      if (artifactManifestHash) {
        const ready = await assertArtifactBundleReady(artifactManifestHash)
        if (!ready.ok) {
          throw new Error(ready.error)
        }
      }

      const actions = await db
        .select()
        .from(appRevisionAction)
        .where(eq(appRevisionAction.revisionId, params.revisionId))

      await db.transaction(async (tx) => {
        await tx
          .select({ id: appProject.id })
          .from(appProject)
          .where(eq(appProject.id, params.projectId))
          .for('update')
          .limit(1)

        const now = new Date()
        const prior = await tx
          .select({ id: appPreviewSession.id })
          .from(appPreviewSession)
          .where(
            and(
              eq(appPreviewSession.projectId, params.projectId),
              eq(appPreviewSession.userId, params.userId),
              sql`${appPreviewSession.stoppedAt} IS NULL`
            )
          )

        for (const row of prior) {
          await tx
            .update(appPreviewSession)
            .set({
              stoppedAt: now,
              buildId: null,
              artifactManifestHash: null,
            })
            .where(eq(appPreviewSession.id, row.id))
          await tx
            .delete(appDeploymentPin)
            .where(
              and(
                eq(appDeploymentPin.kind, 'preview'),
                eq(appDeploymentPin.previewSessionId, row.id)
              )
            )
        }

        await tx.insert(appPreviewSession).values({
          id: sessionId,
          projectId: params.projectId,
          revisionId: params.revisionId,
          userId: params.userId,
          channelNonce,
          buildId: build.id,
          artifactManifestHash,
          startedAt,
          expiresAt,
        })

        for (const action of actions) {
          // Draft-bound actions have no real deployment version to pin.
          // Preview execute authenticates via the session and draft gate instead.
          if (isDraftDeploymentVersionId(action.deploymentVersionId)) {
            continue
          }
          await tx.insert(appDeploymentPin).values({
            id: generateId(),
            kind: 'preview',
            projectId: params.projectId,
            releaseId: null,
            previewSessionId: sessionId,
            revisionId: params.revisionId,
            workflowId: action.workflowId,
            deploymentVersionId: action.deploymentVersionId,
            expiresAt,
            sessionStartedAt: startedAt,
          })
        }
      })
    }
    if (artifactManifestHash) {
      await withArtifactStoreMutationLock(activate)
    } else {
      await activate()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('app_preview_session_active_user_project_unique')) {
      throw new Error('Another preview session is already active; retry')
    }
    throw error
  }

  return {
    sessionId,
    expiresAt,
    channelNonce,
    buildId: build.id,
    artifactManifestHash,
    artifactPreview: Boolean(artifactManifestHash),
    event: {
      type: 'app.preview.ready',
      payload: {
        projectId: params.projectId,
        revisionId: params.revisionId,
        sessionId,
        buildId: build.id,
      },
    },
  }
}

export async function heartbeatPreviewSession(
  sessionId: string,
  ownership?: { projectId: string; userId: string }
): Promise<{ ok: true; expiresAt: Date } | { ok: false; error: string }> {
  const [session] = await db
    .select()
    .from(appPreviewSession)
    .where(eq(appPreviewSession.id, sessionId))
    .limit(1)

  if (!session || session.stoppedAt) {
    return { ok: false, error: 'Preview session not found' }
  }
  if (
    ownership &&
    (session.projectId !== ownership.projectId || session.userId !== ownership.userId)
  ) {
    return { ok: false, error: 'Preview session not found' }
  }
  if (isPreviewSessionPastHardMax(session.startedAt)) {
    await stopPreviewSession(sessionId)
    return { ok: false, error: 'Preview session exceeded hard maximum age; open a new session' }
  }

  const expiresAt = previewPinExpiresAtForSession(session.startedAt)
  await db.transaction(async (tx) => {
    await tx.update(appPreviewSession).set({ expiresAt }).where(eq(appPreviewSession.id, sessionId))
    await tx
      .update(appDeploymentPin)
      .set({ expiresAt })
      .where(
        and(eq(appDeploymentPin.kind, 'preview'), eq(appDeploymentPin.previewSessionId, sessionId))
      )
  })

  return { ok: true, expiresAt }
}

export async function stopPreviewSession(sessionId: string): Promise<void> {
  const now = new Date()
  await db.transaction(async (tx) => {
    // Clear build pin so stopped sessions do not retain app_build rows forever.
    await tx
      .update(appPreviewSession)
      .set({
        stoppedAt: now,
        buildId: null,
        artifactManifestHash: null,
      })
      .where(eq(appPreviewSession.id, sessionId))
    await tx
      .delete(appDeploymentPin)
      .where(
        and(eq(appDeploymentPin.kind, 'preview'), eq(appDeploymentPin.previewSessionId, sessionId))
      )
  })
}

export async function stopActivePreviewSessionsForProject(projectId: string): Promise<number> {
  const active = await db
    .select({ id: appPreviewSession.id })
    .from(appPreviewSession)
    .where(
      and(eq(appPreviewSession.projectId, projectId), sql`${appPreviewSession.stoppedAt} IS NULL`)
    )

  for (const session of active) {
    await stopPreviewSession(session.id)
  }
  return active.length
}

/** Sweep expired preview pins/sessions. */
export async function sweepExpiredPreviewPins(now = new Date()): Promise<number> {
  const hardMaxCutoff = new Date(now.getTime() - PREVIEW_SESSION_HARD_MAX_MS)
  const expired = await db
    .select({ id: appPreviewSession.id })
    .from(appPreviewSession)
    .where(
      and(
        or(lt(appPreviewSession.expiresAt, now), lt(appPreviewSession.startedAt, hardMaxCutoff)),
        sql`${appPreviewSession.stoppedAt} IS NULL`
      )
    )

  for (const row of expired) {
    await stopPreviewSession(row.id)
  }

  // Orphan preview pins without session
  const deleted = await db
    .delete(appDeploymentPin)
    .where(
      and(
        eq(appDeploymentPin.kind, 'preview'),
        or(
          lt(appDeploymentPin.expiresAt, now),
          lt(appDeploymentPin.sessionStartedAt, hardMaxCutoff)
        )
      )
    )
    .returning({ id: appDeploymentPin.id })

  return expired.length + deleted.length
}

export async function revokeAllCallableReleasesForWorkspace(workspaceId: string): Promise<void> {
  const projects = await db
    .select({ id: appProject.id })
    .from(appProject)
    .where(eq(appProject.workspaceId, workspaceId))

  for (const project of projects) {
    const releases = await db
      .select({ id: appRelease.id })
      .from(appRelease)
      .where(and(eq(appRelease.projectId, project.id), eq(appRelease.state, 'published')))

    for (const release of releases) {
      const { revokeRelease } = await import('@/lib/apps/publish')
      const revoked = await revokeRelease({ projectId: project.id, releaseId: release.id })
      if (!revoked.success) {
        throw new Error(
          `Failed to revoke release ${release.id} while archiving workspace apps: ${revoked.error}`
        )
      }
    }

    await stopActivePreviewSessionsForProject(project.id)
    await db
      .update(appProject)
      .set({ archivedAt: new Date(), publishedReleaseId: null, updatedAt: new Date() })
      .where(eq(appProject.id, project.id))
  }
}
