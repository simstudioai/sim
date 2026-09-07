import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { asOrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import { createTrustedCopilotPrincipal } from '@/lib/mothership/auth/application-delegation'
import type { SimControlRequest, SimControlResult } from '@/lib/mothership/generated/sim-transport'
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
  if (operation.input.chatId !== scope.chatId)
    return { status: 403, body: '{"error":"Chat scope mismatch"}' }
  const principal = createTrustedCopilotPrincipal(
    { ...scope, delegationId: `transport:${request.id}` },
    {
      audience: operation.kind === 'run_control' ? RUN_CONTROL_AUDIENCE : TASK_DELEGATION_AUDIENCE,
      ttlMs: 60_000,
    }
  )
  try {
    switch (operation.kind) {
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
