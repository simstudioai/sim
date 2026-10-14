import { markCopilotProjectFileRequest } from '@/lib/api/server/routes/copilot-request'
import { createScopedCliTransport } from '@/lib/mothership/agent-cli/scoped-transport'
import type { CopilotExecutionContext } from '@/lib/mothership/auth/application-delegation'
import type { ProjectFileTarget } from '@/lib/projects/files/application/authorization'

const PROJECT_FILES_ROUTE = '/api/v2/projects/{projectId}/files'

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
