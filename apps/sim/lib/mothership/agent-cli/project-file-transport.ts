import type { Logger } from '@sim/logger'
import { v2ListProjectFilesContract } from '@/lib/api/contracts/v2/project-files'
import type { MatchedRoute } from '@/lib/api/server/routes/in-process-transport'
import { v2OrchestrationErrorPolicy } from '@/lib/api/server/routes/v2-json-route'
import { tryMatchV2Route, v2RoutePattern } from '@/lib/api/server/routes/v2-route-pattern'
import { createScopedCliTransport } from '@/lib/mothership/agent-cli/scoped-transport'
import { markCopilotProjectFileRequest } from '@/lib/mothership/application/execute-project-file-use-case'
import type { CopilotExecutionContext } from '@/lib/mothership/auth/application-delegation'
import type { ProjectFileTarget } from '@/lib/projects/files/application/authorization'
import { v2Error } from '@/app/api/v2/lib/response'

const PROJECT_FILES_ROUTE = v2RoutePattern(v2ListProjectFilesContract)

/** Project transport binds owner-specific routes to exact, freshly authorized resource grants. */
export function createProjectFileCliTransport(
  endpoint: string,
  context: CopilotExecutionContext,
  target: ProjectFileTarget
): typeof fetch {
  const bound = Object.freeze({ ...target })
  return createScopedCliTransport(endpoint, {
    admitRequest(request, route) {
      if (
        (route.pattern !== PROJECT_FILES_ROUTE &&
          !route.pattern.startsWith(`${PROJECT_FILES_ROUTE}/`)) ||
        route.params.projectId !== bound.projectId ||
        (bound.fileId !== undefined && route.params.fileId !== bound.fileId)
      ) {
        return Response.json({ error: 'CLI target is unavailable' }, { status: 400 })
      }
      try {
        markCopilotProjectFileRequest(request, context, {
          projectId: bound.projectId,
          ...(route.params.fileId !== undefined ? { fileId: route.params.fileId } : {}),
        })
      } catch {
        return Response.json({ error: 'Project file authority is unavailable' }, { status: 403 })
      }
    },
  })
}

/** The route of a request addressed to this Project on the CLI's own origin, or its refusal. */
export function matchProjectCliRoute(
  request: Request,
  origin: string,
  projectId: string
): MatchedRoute | Response {
  const url = new URL(request.url)
  const route = url.origin === origin ? tryMatchV2Route(url.pathname) : null
  if (!route || route.params.projectId !== projectId) {
    return v2Error('BAD_REQUEST', 'CLI target is unavailable')
  }
  return route
}

/** Stops a private Project handler once its invocation or its request is cancelled. */
export function throwIfCancelled(...signals: (AbortSignal | undefined)[]): void {
  for (const signal of signals) signal?.throwIfAborted()
}

/** Renders a private Project handler failure as its v2 envelope; cancellation is rethrown first. */
export function renderProjectCliFailure(
  error: unknown,
  signals: (AbortSignal | undefined)[],
  logger: Logger,
  failure: { log: string; message: string }
): Response {
  throwIfCancelled(...signals)
  const response = v2OrchestrationErrorPolicy.render(error)
  if (response) return response
  logger.error(failure.log, { error })
  return v2Error('INTERNAL_ERROR', failure.message)
}
