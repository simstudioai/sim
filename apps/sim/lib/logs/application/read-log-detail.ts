import { resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import { jobExecutionLogs, workflowExecutionLogs } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import type { WorkflowLogDetail } from '@/lib/api/contracts/logs'
import { defineAuthorizedWorkspaceUseCase, type OperationUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  isConcealedLogAuthorizationError,
  logDelegationAuthorization,
} from '@/lib/logs/application/authorization'
import { logOperations } from '@/lib/logs/application/operations'
import { readLogDetail } from '@/lib/logs/fetch-log-detail'
import {
  type ActiveWorkspaceApplicationContext,
  resolveActiveWorkspaceApplicationContext,
} from '@/lib/workspaces/application/workspace-context'

export interface ReadLogDetailInput {
  workspaceId: string
  lookupColumn: 'id' | 'executionId'
  lookupValue: string
  signal?: AbortSignal
}

interface ReadLogDetailContext extends ActiveWorkspaceApplicationContext {
  executionId: string
}

async function resolveReadLogDetailContext(
  input: ReadLogDetailInput
): Promise<ReadLogDetailContext> {
  input.signal?.throwIfAborted()
  const workflowLookup =
    input.lookupColumn === 'id'
      ? eq(workflowExecutionLogs.id, input.lookupValue)
      : eq(workflowExecutionLogs.executionId, input.lookupValue)
  const [workflowRecord] = await db
    .select({
      workspaceId: workflowExecutionLogs.workspaceId,
      executionId: workflowExecutionLogs.executionId,
    })
    .from(workflowExecutionLogs)
    .where(workflowLookup)
    .limit(1)
  input.signal?.throwIfAborted()

  let record = workflowRecord
  if (!record) {
    const jobLookup =
      input.lookupColumn === 'id'
        ? eq(jobExecutionLogs.id, input.lookupValue)
        : eq(jobExecutionLogs.executionId, input.lookupValue)
    const [jobRecord] = await db
      .select({
        workspaceId: jobExecutionLogs.workspaceId,
        executionId: jobExecutionLogs.executionId,
      })
      .from(jobExecutionLogs)
      .where(jobLookup)
      .limit(1)
    record = jobRecord
    input.signal?.throwIfAborted()
  }

  if (!record || record.workspaceId !== input.workspaceId) {
    throw new OrchestrationError('not_found', 'Not found')
  }
  const workspace = await resolveActiveWorkspaceApplicationContext(record.workspaceId)
  input.signal?.throwIfAborted()
  return { ...workspace, executionId: record.executionId }
}

const authorizedReadLogDetailUseCase = defineAuthorizedWorkspaceUseCase({
  operation: logOperations.readDetail,
  resolveContext: ({ input }: { input: ReadLogDetailInput }) => resolveReadLogDetailContext(input),
  authorizationOptions: logDelegationAuthorization<ReadLogDetailContext>(),
  async execute({ principal, input, context }) {
    input.signal?.throwIfAborted()
    // Attribution, not authorization: an actorless run (a schedule, or a webhook
    // with no external subject) reads its own workspace's logs with no user to name.
    const detail = await readLogDetail({
      viewerUserId: resolvePrincipalSubjectUserId(principal),
      workspaceId: context.workspaceId,
      lookupColumn: input.lookupColumn,
      lookupValue: input.lookupValue,
      signal: input.signal,
    })
    input.signal?.throwIfAborted()
    if (!detail) throw new OrchestrationError('not_found', 'Not found')
    return { detail }
  },
})

export const readLogDetailUseCase: OperationUseCase<
  typeof logOperations.readDetail,
  ReadLogDetailInput,
  { detail: WorkflowLogDetail }
> = {
  operation: logOperations.readDetail,
  async execute(args) {
    try {
      return await authorizedReadLogDetailUseCase.execute(args)
    } catch (error) {
      if (isConcealedLogAuthorizationError(error)) {
        throw new OrchestrationError('not_found', 'Not found')
      }
      throw error
    }
  },
}
