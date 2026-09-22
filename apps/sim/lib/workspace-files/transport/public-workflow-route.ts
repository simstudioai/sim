import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  readPublicFileWorkflowContract,
  readPublicFileWorkflowInputContract,
  runPublicFileWorkflowContract,
} from '@/lib/api/contracts/file-workflows'
import { parseRequest } from '@/lib/api/server'
import {
  asOrchestrationError,
  OrchestrationError,
  statusForOrchestrationError,
} from '@/lib/core/orchestration/types'
import { validateDeploymentAuth } from '@/lib/core/security/deployment-auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { enforcePublicFileRateLimit } from '@/lib/public-shares/rate-limit'
import { accessSharedFileWorkflow } from '@/lib/workspace-files/application/file-workflows'

/** Public share execution uses the deployment-auth lifecycle instead of a workspace session. */
export function publicWorkflowRoute(mode: 'run' | 'read' | 'read-input') {
  return withRouteHandler(
    async (
      request: NextRequest,
      context: { params: Promise<{ token: string; workflowId: string }> }
    ) => {
      const headers = { 'Cache-Control': 'private, no-store' }
      const limited = await enforcePublicFileRateLimit(request, 'workflow')
      if (limited) {
        limited.headers.set('Cache-Control', headers['Cache-Control'])
        return limited
      }
      const contract =
        mode === 'run'
          ? runPublicFileWorkflowContract
          : mode === 'read-input'
            ? readPublicFileWorkflowInputContract
            : readPublicFileWorkflowContract
      const parsed = await parseRequest(contract, request, context, { maxBodyBytes: 20 * 1024 })
      if (!parsed.success) {
        parsed.response.headers.set('Cache-Control', headers['Cache-Control'])
        return parsed.response
      }
      try {
        const result = await accessSharedFileWorkflow({
          ...parsed.data.params,
          input: mode === 'read' ? undefined : parsed.data.body?.input,
          run: mode === 'run',
          async authenticateShare(share) {
            const auth = await validateDeploymentAuth(
              generateRequestId(),
              share,
              request,
              {},
              'file'
            )
            if (!auth.authorized)
              throw new OrchestrationError(
                'unauthorized',
                auth.error ?? 'File authentication required'
              )
          },
        })
        return NextResponse.json(contract.response.schema.parse(result), { headers })
      } catch (error) {
        const classified = asOrchestrationError(error)
        if (!classified) throw error
        return NextResponse.json(
          { error: classified.code === 'internal' ? 'Internal server error' : classified.message },
          { status: statusForOrchestrationError(classified.code), headers }
        )
      }
    }
  )
}
