import type { ResourceDelegatedPrincipal } from '@sim/auth/principal'
import { NextRequest } from 'next/server'
import { fileCopyInputSchema } from '@/lib/api/contracts/file-copy-input'
import { v2CopyFileItemsContract } from '@/lib/api/contracts/v2/file-copy'
import { markCopilotResourceRequest } from '@/lib/api/server/routes/copilot-request'
import { V2_PARSE_DEFAULTS, v2InvalidBodyResponse } from '@/lib/api/server/routes/v2-json-route'
import { isV2ContractRoute } from '@/lib/api/server/routes/v2-route-pattern'
import { parseRequest } from '@/lib/api/server/validation'
import { requireResourceDelegation } from '@/lib/core/application/resource-delegation'
import { createScopedCliTransport } from '@/lib/mothership/agent-cli/scoped-transport'
import {
  type CopilotExecutionContext,
  createCopilotResourceApplicationPrincipal,
  requireTrustedCopilotResourceExecutionContext,
} from '@/lib/mothership/auth/application-delegation'
import type { CopyFileItemsInput } from '@/lib/workspace-files/application/copy-authorization'
import {
  FILE_COPY_DELEGATION_TTL_MS,
  fileCopyOperation,
} from '@/lib/workspace-files/application/copy-operation'
import { v2Error } from '@/app/api/v2/lib/response'

/** Carries one immutable paired grant to the registered compound operation without a wire credential. */
function markCopilotFileCopyRequest(
  request: Request,
  context: CopilotExecutionContext,
  target: CopyFileItemsInput
): ResourceDelegatedPrincipal {
  const principal = createCopilotResourceApplicationPrincipal(
    requireTrustedCopilotResourceExecutionContext(context),
    {
      audience: fileCopyOperation.delegationAudience,
      ttlMs: FILE_COPY_DELEGATION_TTL_MS,
      createDelegationId: (trusted) => trusted.toolCallId,
      scope: { kind: 'file_copy', ...target },
    }
  )
  markCopilotResourceRequest(request, (operation, audience) =>
    operation === fileCopyOperation && audience === fileCopyOperation.delegationAudience
      ? principal
      : undefined
  )
  return principal
}

/** Binds the native request body to one paired capability; the application rechecks both current owners. */
export function createFileCopyCliTransport(
  endpoint: string,
  context: CopilotExecutionContext,
  target: CopyFileItemsInput
): typeof fetch {
  const bound = fileCopyInputSchema.parse(target)
  return createScopedCliTransport(endpoint, {
    async admitRequest(request, route) {
      if (!isV2ContractRoute(request.method, route, v2CopyFileItemsContract)) {
        return v2Error('BAD_REQUEST', 'CLI target is unavailable')
      }
      const parsed = await parseRequest(
        v2CopyFileItemsContract,
        new NextRequest(request.clone()),
        {},
        {
          ...V2_PARSE_DEFAULTS,
          invalidJsonResponse: () => v2InvalidBodyResponse(request),
        }
      )
      if (!parsed.success) return parsed.response
      request.signal.throwIfAborted()
      try {
        const principal = markCopilotFileCopyRequest(request, context, bound)
        requireResourceDelegation(principal, {
          audience: fileCopyOperation.delegationAudience,
          services: fileCopyOperation.delegatedServices,
          scope: { kind: 'file_copy', ...parsed.data.body },
          maxTtlMs: FILE_COPY_DELEGATION_TTL_MS,
        })
      } catch {
        return v2Error('FORBIDDEN', 'File copy authority is unavailable')
      }
    },
  })
}
