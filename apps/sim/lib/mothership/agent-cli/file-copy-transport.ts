import { NextRequest } from 'next/server'
import { fileCopyInputSchema } from '@/lib/api/contracts/mothership-file-copy'
import { v2CopyFileItemsContract } from '@/lib/api/contracts/v2/file-copy'
import { markCopilotFileCopyRequest } from '@/lib/api/server/routes/copilot-request'
import { V2_PARSE_DEFAULTS, v2InvalidBodyResponse } from '@/lib/api/server/routes/v2-json-route'
import { parseRequest } from '@/lib/api/server/validation'
import { requireResourceDelegation } from '@/lib/core/application/resource-delegation'
import { createScopedCliTransport } from '@/lib/mothership/agent-cli/scoped-transport'
import type { CopilotExecutionContext } from '@/lib/mothership/auth/application-delegation'
import type { CopyFileItemsInput } from '@/lib/workspace-files/application/copy-authorization'
import {
  FILE_COPY_DELEGATION_TTL_MS,
  fileCopyOperation,
} from '@/lib/workspace-files/application/copy-operation'
import { v2Error } from '@/app/api/v2/lib/response'

/** Binds the native request body to one paired capability; the application rechecks both current owners. */
export function createFileCopyCliTransport(
  endpoint: string,
  context: CopilotExecutionContext,
  target: CopyFileItemsInput
): typeof fetch {
  const bound = fileCopyInputSchema.parse(target)
  return createScopedCliTransport(endpoint, {
    async admitRequest(request, route) {
      if (route.pattern !== v2CopyFileItemsContract.path || request.method !== 'POST') {
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
