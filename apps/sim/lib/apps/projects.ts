import { randomBytes } from 'node:crypto'
import { db } from '@sim/db'
import { appProject, appRelease } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { isValidAppSlug } from '@/lib/apps/reserved-slugs'

function generatePublicId(): string {
  return randomBytes(12).toString('base64url')
}

export async function createAppProject(params: {
  workspaceId: string
  name: string
  slug: string
  userId: string
  createdFromChatId?: string | null
}): Promise<
  | { success: true; project: typeof appProject.$inferSelect }
  | { success: false; error: string; status: number }
> {
  if (!isValidAppSlug(params.slug)) {
    return { success: false, error: 'Invalid or reserved slug', status: 400 }
  }

  if (params.createdFromChatId) {
    const [existing] = await db
      .select({ id: appProject.id })
      .from(appProject)
      .where(
        and(
          eq(appProject.createdFromChatId, params.createdFromChatId),
          isNull(appProject.archivedAt)
        )
      )
      .limit(1)
    if (existing) {
      return {
        success: false,
        error: 'This Full-stack chat already has a linked App',
        status: 409,
      }
    }
  }

  const id = generateId()
  const publicId = generatePublicId()
  const now = new Date()

  try {
    const [project] = await db
      .insert(appProject)
      .values({
        id,
        workspaceId: params.workspaceId,
        name: params.name,
        publicId,
        slug: params.slug,
        createdFromChatId: params.createdFromChatId ?? null,
        lastBuilderChatId: params.createdFromChatId ?? null,
        createdBy: params.userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    return { success: true, project }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('app_project_workspace_slug_unique')) {
      return { success: false, error: 'Slug already in use in this workspace', status: 409 }
    }
    if (message.includes('app_project_active_created_from_chat_unique')) {
      return {
        success: false,
        error: 'This Full-stack chat already has a linked App',
        status: 409,
      }
    }
    return { success: false, error: 'Failed to create app project', status: 500 }
  }
}

export async function listAppProjects(workspaceId: string) {
  return db
    .select()
    .from(appProject)
    .where(and(eq(appProject.workspaceId, workspaceId), isNull(appProject.archivedAt)))
    .orderBy(desc(appProject.updatedAt))
}

export async function getAppProject(projectId: string) {
  const [project] = await db
    .select()
    .from(appProject)
    .where(and(eq(appProject.id, projectId), isNull(appProject.archivedAt)))
    .limit(1)
  return project ?? null
}

export async function getLinkedAppProjectForChat(chatId: string, workspaceId: string) {
  const selection = {
    id: appProject.id,
    name: appProject.name,
    slug: appProject.slug,
    publicId: appProject.publicId,
    draftRevisionId: appProject.draftRevisionId,
    publishedReleaseId: appProject.publishedReleaseId,
  }
  const [createdProject] = await db
    .select(selection)
    .from(appProject)
    .where(
      and(
        eq(appProject.workspaceId, workspaceId),
        isNull(appProject.archivedAt),
        eq(appProject.createdFromChatId, chatId)
      )
    )
    .limit(1)
  if (createdProject) return createdProject

  const [builderProject] = await db
    .select(selection)
    .from(appProject)
    .where(
      and(
        eq(appProject.workspaceId, workspaceId),
        isNull(appProject.archivedAt),
        isNull(appProject.createdFromChatId),
        eq(appProject.lastBuilderChatId, chatId)
      )
    )
    .orderBy(desc(appProject.updatedAt))
    .limit(1)
  return builderProject ?? null
}

/** Pointer-only: at most the current publishedReleaseId is callable. */
export async function getCurrentRelease(projectId: string) {
  const [project] = await db
    .select({ publishedReleaseId: appProject.publishedReleaseId })
    .from(appProject)
    .where(eq(appProject.id, projectId))
    .limit(1)

  if (!project?.publishedReleaseId) return null

  const [release] = await db
    .select()
    .from(appRelease)
    .where(
      and(
        eq(appRelease.id, project.publishedReleaseId),
        eq(appRelease.projectId, projectId),
        eq(appRelease.state, 'published'),
        isNull(appRelease.revokedAt)
      )
    )
    .limit(1)

  return release ?? null
}

/** @deprecated Use getCurrentRelease — pointer-only returns at most one. */
export async function listCallableReleases(projectId: string) {
  const current = await getCurrentRelease(projectId)
  return current ? [current] : []
}

/**
 * Archive an app: revoke every published release (and pins) first, then clear the pointer.
 * Callers must not skip revoke — this is the single safe archive entrypoint.
 */
export async function archiveAppProject(
  projectId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const { revokeRelease } = await import('@/lib/apps/publish')
  const { stopActivePreviewSessionsForProject } = await import('@/lib/apps/pins')

  const published = await db
    .select({ id: appRelease.id })
    .from(appRelease)
    .where(and(eq(appRelease.projectId, projectId), eq(appRelease.state, 'published')))

  for (const release of published) {
    const revoked = await revokeRelease({ projectId, releaseId: release.id })
    if (!revoked.success) {
      return {
        success: false,
        error: `Failed to revoke release ${release.id} before archive: ${revoked.error}`,
      }
    }
  }

  await stopActivePreviewSessionsForProject(projectId)
  const now = new Date()
  await db
    .update(appProject)
    .set({ archivedAt: now, publishedReleaseId: null, updatedAt: now })
    .where(eq(appProject.id, projectId))

  return { success: true }
}
