import { db } from '@sim/db'
import { appBuild, appProject, appRelease } from '@sim/db/schema'
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { appProjectThumbnailContract } from '@/lib/api/contracts/apps'
import { parseRequest } from '@/lib/api/server'
import { readArtifactFile } from '@/lib/apps/artifacts/store'
import { APP_THUMBNAIL_PATH } from '@/lib/apps/build/thumbnail'
import { assertAppPermission } from '@/lib/apps/permissions'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createErrorResponse } from '@/app/api/workflows/utils'

const THUMBNAIL_CACHE_CONTROL = 'private, max-age=300'

function missingThumbnailResponse(): Response {
  return new Response(null, {
    status: 404,
    headers: {
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

export function requestAcceptsEtag(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false
  return ifNoneMatch
    .split(',')
    .map((value) => value.trim().replace(/^W\//, ''))
    .some((value) => value === etag || value === '*')
}

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ projectId: string }> }) => {
    const session = await getSession()
    if (!session) return createErrorResponse('Unauthorized', 401)

    const parsed = await parseRequest(appProjectThumbnailContract, request, context)
    if (!parsed.success) return parsed.response
    const { projectId } = parsed.data.params

    const [project] = await db
      .select({
        id: appProject.id,
        workspaceId: appProject.workspaceId,
        draftRevisionId: appProject.draftRevisionId,
        publishedReleaseId: appProject.publishedReleaseId,
      })
      .from(appProject)
      .where(and(eq(appProject.id, projectId), isNull(appProject.archivedAt)))
      .limit(1)
    if (!project) return missingThumbnailResponse()

    const permission = await assertAppPermission(session.user.id, project.workspaceId, 'edit')
    if (!permission.ok) return createErrorResponse(permission.message, permission.status)

    const manifestCandidates: string[] = []
    if (project.draftRevisionId) {
      const [draftBuild] = await db
        .select({ artifactManifestHash: appBuild.artifactManifestHash })
        .from(appBuild)
        .where(
          and(
            eq(appBuild.projectId, projectId),
            eq(appBuild.revisionId, project.draftRevisionId),
            eq(appBuild.status, 'succeeded'),
            isNotNull(appBuild.artifactManifestHash)
          )
        )
        .orderBy(desc(appBuild.createdAt))
        .limit(1)
      if (draftBuild?.artifactManifestHash) {
        manifestCandidates.push(draftBuild.artifactManifestHash)
      }
    }

    if (project.publishedReleaseId) {
      const [release] = await db
        .select({ artifactManifestHash: appRelease.artifactManifestHash })
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
      if (release?.artifactManifestHash) {
        manifestCandidates.push(release.artifactManifestHash)
      }
    }

    for (const manifestHash of new Set(manifestCandidates)) {
      if (!manifestHash.startsWith('sha256:')) continue
      const thumbnail = await readArtifactFile(manifestHash, APP_THUMBNAIL_PATH)
      if (!thumbnail || thumbnail.contentType !== 'image/webp') continue

      const headers = {
        'cache-control': THUMBNAIL_CACHE_CONTROL,
        'content-type': 'image/webp',
        etag: thumbnail.etag,
        'x-content-type-options': 'nosniff',
      }
      if (requestAcceptsEtag(request.headers.get('if-none-match'), thumbnail.etag)) {
        return new Response(null, { status: 304, headers })
      }
      return new Response(new Uint8Array(thumbnail.content), {
        status: 200,
        headers: {
          ...headers,
          'content-length': String(thumbnail.content.byteLength),
        },
      })
    }

    return missingThumbnailResponse()
  }
)
