import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { asOrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import { HttpError } from '@/lib/core/utils/http-error'
import {
  createTrustedCopilotPrincipal,
  createTrustedOrganizationCopilotPrincipal,
} from '@/lib/mothership/auth/application-delegation'
import { readWorkspaceContext } from '@/lib/mothership/chat/application/workspace-context'
import { WORKSPACE_TARGET_AUDIENCE } from '@/lib/mothership/chat/application/workspace-target'
import type { SimControlRequest, SimControlResult } from '@/lib/mothership/generated/sim-transport'
import {
  INTEGRATION_CATALOG_AUDIENCE,
  readIntegrationCatalog,
} from '@/lib/mothership/integrations/application/catalog'
import {
  MEMORY_NOTES_ACCESS_AUDIENCE,
  resolveMemoryNotesAccess,
} from '@/lib/mothership/memories/application/resolve-access'
import {
  MEMORY_SCOPE_AUDIENCE,
  readMemoryScope,
} from '@/lib/mothership/memory/application/read-scope'
import {
  RUN_CONTROL_AUDIENCE,
  readRunControl,
} from '@/lib/mothership/request/application/read-control'
import { TASK_DELEGATION_AUDIENCE } from '@/lib/mothership/tasks/application/context'
import { prepareTaskWake } from '@/lib/mothership/tasks/application/prepare-wake'
import { readWatchedWorkflowStatus } from '@/lib/mothership/tasks/application/read-workflow-status'
import { runWakeTurn } from '@/lib/mothership/tasks/wake'

const logger = createLogger('MothershipControlTransport')

/** The outbound receiver invokes the same authorized use cases as the HTTP routes. */
export async function executeSimControl(request: SimControlRequest): Promise<SimControlResult> {
  if (request.expiresAt <= Date.now()) return { status: 410, body: '{"error":"Request expired"}' }
  const { scope, operation } = request
  if (scope.workspaceId && scope.organizationId)
    return { status: 403, body: '{"error":"Invalid owner scope"}' }
  if ('chatId' in operation.input && operation.input.chatId !== scope.chatId)
    return { status: 403, body: '{"error":"Chat scope mismatch"}' }
  const liveCallback = operation.kind !== 'wake'
  if (
    (!scope.workspaceId && !scope.organizationId && !liveCallback) ||
    (request.executionStreamId !== undefined && !liveCallback)
  )
    return { status: 403, body: '{"error":"Invalid execution scope"}' }
  if (
    operation.kind === 'run_control' &&
    request.executionStreamId !== undefined &&
    request.executionStreamId !== operation.input.streamId
  )
    return { status: 403, body: '{"error":"Execution stream mismatch"}' }
  const options = {
    audience:
      operation.kind === 'memory_notes_access'
        ? MEMORY_NOTES_ACCESS_AUDIENCE
        : operation.kind === 'memory_scope'
          ? MEMORY_SCOPE_AUDIENCE
          : operation.kind === 'integration_catalog'
            ? INTEGRATION_CATALOG_AUDIENCE
            : operation.kind === 'workspace_context'
              ? WORKSPACE_TARGET_AUDIENCE
              : operation.kind === 'run_control'
                ? RUN_CONTROL_AUDIENCE
                : TASK_DELEGATION_AUDIENCE,
    ttlMs: Math.min(60_000, request.expiresAt - Date.now()),
  }
  if (options.ttlMs <= 0) return { status: 410, body: '{"error":"Request expired"}' }
  const identity = {
    ...scope,
    executionStreamId: request.executionStreamId,
    delegationId: `transport:${request.id}`,
  }
  const principal = scope.organizationId
    ? createTrustedOrganizationCopilotPrincipal(
        { ...identity, organizationId: scope.organizationId },
        options
      )
    : scope.workspaceId
      ? createTrustedCopilotPrincipal({ ...identity, workspaceId: scope.workspaceId }, options)
      : createTrustedCopilotPrincipal(
          {
            userId: scope.userId,
            chatId: scope.chatId,
            delegationId: identity.delegationId,
            ...(request.executionStreamId ? { executionStreamId: request.executionStreamId } : {}),
          },
          options
        )
  try {
    switch (operation.kind) {
      case 'memory_notes_access':
        return {
          status: 200,
          body: JSON.stringify(
            await resolveMemoryNotesAccess.execute({ principal, input: operation.input })
          ),
        }
      case 'memory_scope':
        return {
          status: 200,
          body: JSON.stringify(
            await readMemoryScope.execute({ principal, input: operation.input })
          ),
        }
      case 'integration_catalog':
        return {
          status: 200,
          body: JSON.stringify(
            await readIntegrationCatalog.execute({ principal, input: operation.input })
          ),
        }
      case 'workspace_context':
        return {
          status: 200,
          body: JSON.stringify(
            await readWorkspaceContext.execute({ principal, input: operation.input })
          ),
        }
      case 'run_control':
        return {
          status: 200,
          body: JSON.stringify(await readRunControl.execute({ principal, input: operation.input })),
        }
      case 'workflow_status':
        return {
          status: 200,
          body: JSON.stringify(
            await readWatchedWorkflowStatus.execute({ principal, input: operation.input })
          ),
        }
      case 'wake': {
        const result = await prepareTaskWake.execute({ principal, input: operation.input })
        void runWakeTurn(operation.input)
        return { status: 200, body: JSON.stringify(result) }
      }
    }
  } catch (error) {
    if (error instanceof HttpError) {
      return { status: error.statusCode, body: JSON.stringify({ error: error.message }) }
    }
    const classified = asOrchestrationError(error)
    if (!classified || classified.code === 'internal') {
      logger.error('Sim control failed', { kind: operation.kind, error: getErrorMessage(error) })
    }
    return {
      status: statusForOrchestrationError(classified?.code),
      body: JSON.stringify({
        error:
          classified && classified.code !== 'internal'
            ? classified.message
            : 'Internal server error',
      }),
    }
  }
}
