import { createLogger } from '@sim/logger'
import { buildProjectRevision } from '@/lib/apps/build/project-build'
import type { BackendHandoff } from '@/lib/apps/demo/backend-handoff'
import { buildFallbackFrontend, type GeneratedFrontend } from '@/lib/apps/demo/frontend-generator'
import { createRevisionWithActions, restoreDraftRevisionPointer } from '@/lib/apps/revisions'

const logger = createLogger('FullstackDemoFrontendBuild')

export type DemoFrontendBuildResult =
  | {
      ok: true
      revisionId: string
      frontendSource: GeneratedFrontend['source']
    }
  | {
      ok: false
      revisionId: string
      error: string
    }

async function createAndBuild(params: {
  projectId: string
  userId: string
  handoff: BackendHandoff
  frontend: GeneratedFrontend
  parentRevisionId?: string | null
  /** When set, preserve prior bound actions instead of replacing from handoff. */
  actions?: BackendHandoff['actions'][number]['action'][]
  expectedRevisionId?: string | null
}): Promise<{ ok: true; revisionId: string } | { ok: false; revisionId: string; error: string }> {
  const { revisionId } = await createRevisionWithActions({
    projectId: params.projectId,
    userId: params.userId,
    actions: params.actions ?? params.handoff.actions.map((action) => action.action),
    files: params.frontend.files,
    parentRevisionId: params.parentRevisionId ?? undefined,
    expectedRevisionId: params.expectedRevisionId,
  })
  const build = await buildProjectRevision({
    projectId: params.projectId,
    revisionId,
    userId: params.userId,
  })
  if (!build.ok) {
    return { ok: false, revisionId, error: build.error }
  }
  return { ok: true, revisionId }
}

/**
 * Build the hosted frontend, then recover with the deterministic fallback on
 * any Vite/build failure. Failed hosted revisions remain immutable evidence;
 * the fallback becomes a child draft revision.
 */
export async function buildDemoFrontendRevision(params: {
  projectId: string
  userId: string
  prompt: string
  handoff: BackendHandoff
  frontend: GeneratedFrontend
  parentRevisionId?: string | null
  expectedRevisionId?: string | null
  /** When true, skip fallback rebuild and keep the previous successful preview. */
  skipFallback?: boolean
  preserveActions?: BackendHandoff['actions'][number]['action'][]
  onFallback?: (buildError: string) => void | Promise<void>
}): Promise<DemoFrontendBuildResult> {
  let primary: Awaited<ReturnType<typeof createAndBuild>>
  try {
    primary = await createAndBuild({
      ...params,
      actions: params.preserveActions,
    })
  } catch (error) {
    return {
      ok: false,
      revisionId: params.parentRevisionId ?? params.expectedRevisionId ?? '',
      error: error instanceof Error ? error.message : 'Failed to create App revision',
    }
  }
  if (primary.ok) {
    return {
      ok: true,
      revisionId: primary.revisionId,
      frontendSource: params.frontend.source,
    }
  }

  if (params.frontend.source === 'fallback' || params.skipFallback) {
    await restoreDraftRevisionPointer({
      projectId: params.projectId,
      failedRevisionId: primary.revisionId,
      parentRevisionId: params.parentRevisionId ?? null,
    })
    return primary
  }

  logger.warn('Hosted frontend failed to build; rebuilding deterministic fallback', {
    projectId: params.projectId,
    revisionId: primary.revisionId,
    error: primary.error,
  })
  await params.onFallback?.(primary.error)

  const fallback = buildFallbackFrontend(params.handoff, params.prompt)
  const recovered = await createAndBuild({
    ...params,
    frontend: fallback,
    parentRevisionId: primary.revisionId,
    expectedRevisionId: primary.revisionId,
    actions: params.preserveActions,
  })
  if (!recovered.ok) {
    await restoreDraftRevisionPointer({
      projectId: params.projectId,
      failedRevisionId: recovered.revisionId,
      parentRevisionId: params.parentRevisionId ?? null,
    })
    return {
      ok: false,
      revisionId: recovered.revisionId,
      error: `Fallback build failed after hosted frontend build error: ${recovered.error}`,
    }
  }

  return {
    ok: true,
    revisionId: recovered.revisionId,
    frontendSource: 'fallback',
  }
}
