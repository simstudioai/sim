import type { Command } from 'commander'
import { clientFrom } from '../../context'
import { CLI_CONTRACT } from '../../contract/commands'
import { type GetWorkspaceOperationResponse, V2_OPERATIONS } from '../../generated/v2-api'
import { sleep } from '../../helpers'
import { resolvePath, SimApiError, type SimClient } from '../../http/client'
import { renderResult } from '../../runtime/result'

type WorkspaceOperation = GetWorkspaceOperationResponse['data']
const EXIT_CODES = {
  completed: 0,
  completed_with_warnings: 0,
  requires_configuration: 3,
  failed: 1,
  processing: 0,
} as const

export function readWorkspaceOperation(raw: unknown): WorkspaceOperation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new SimApiError('The API returned no workspace operation receipt', 0)
  const value = 'data' in raw ? raw.data : raw
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('status' in value) ||
    typeof value.status !== 'string' ||
    !Object.hasOwn(EXIT_CODES, value.status) ||
    !('operationId' in value) ||
    typeof value.operationId !== 'string' ||
    !('requestId' in value) ||
    typeof value.requestId !== 'string' ||
    !('workspaceId' in value) ||
    typeof value.workspaceId !== 'string' ||
    !('applied' in value) ||
    value.applied !== true
  ) {
    throw new SimApiError('The API returned an invalid workspace operation receipt', 0)
  }
  return value as WorkspaceOperation
}

export function workspaceWaitTimeout(raw: unknown): number {
  if (raw === undefined) return 3600
  const seconds = typeof raw === 'string' && raw.trim() === '' ? Number.NaN : Number(raw)
  if (!Number.isFinite(seconds) || seconds < 0)
    throw new SimApiError(
      '--wait-timeout must be a non-negative number of seconds (0 waits indefinitely)',
      0
    )
  return seconds
}

export function assertWorkspaceOperationOutcome(
  report: WorkspaceOperation,
  timedOut = false
): void {
  const exitCode = timedOut ? 4 : EXIT_CODES[report.status]
  if (!exitCode) return
  throw new SimApiError(
    timedOut
      ? 'Waiting timed out; reconcile using the same operation or request ID'
      : report.status === 'requires_configuration'
        ? 'The operation committed and requires destination configuration'
        : 'The operation committed, but follow-up work failed',
    0,
    timedOut ? 'OPERATION_WAIT_TIMEOUT' : report.status.toUpperCase(),
    {
      operationId: report.operationId,
      requestId: report.requestId,
      workspaceId: report.workspaceId,
      applied: report.applied,
      status: report.status,
      issues: report.issues,
    },
    exitCode
  )
}

/** Polls only the existing operation; uncertain mutations are never retried with a new ID. */
export async function waitWorkspaceOperation(
  client: SimClient,
  workspaceId: string,
  operationId: string,
  timeoutSeconds: number,
  initial?: WorkspaceOperation
): Promise<{ report: WorkspaceOperation; timedOut: boolean }> {
  const deadline =
    timeoutSeconds === 0 ? Number.POSITIVE_INFINITY : Date.now() + timeoutSeconds * 1000
  const path = resolvePath(V2_OPERATIONS.getWorkspaceOperation.path, { workspaceId, operationId })
  let report = initial
  let delay = 1000
  for (;;) {
    if (report && (report.workspaceId !== workspaceId || report.operationId !== operationId))
      throw new SimApiError(
        'Operation status response has a different identity',
        0,
        'INVALID_OPERATION_RECEIPT',
        { workspaceId, operationId }
      )
    if (report && report.status !== 'processing') return { report, timedOut: false }
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      if (report) return { report, timedOut: true }
      throw new SimApiError(
        'Waiting timed out before a status response; reconcile using the same operation ID',
        0,
        'OPERATION_WAIT_TIMEOUT',
        { workspaceId, operationId },
        4
      )
    }
    try {
      const nextReport = readWorkspaceOperation(
        await client.request(path, {
          signal: Number.isFinite(remaining)
            ? AbortSignal.timeout(Math.max(1, Math.ceil(remaining)))
            : undefined,
        })
      )
      if (nextReport.workspaceId !== workspaceId || nextReport.operationId !== operationId)
        throw new SimApiError(
          'Operation status response has a different identity',
          0,
          'INVALID_OPERATION_RECEIPT'
        )
      report = nextReport
    } catch (error) {
      if (Date.now() >= deadline) {
        if (report) return { report, timedOut: true }
        throw new SimApiError(
          'Waiting timed out before a status response; reconcile using the same operation ID',
          0,
          'OPERATION_WAIT_TIMEOUT',
          { workspaceId, operationId },
          4
        )
      }
      const failure =
        error instanceof SimApiError
          ? error
          : new SimApiError('Unable to read operation status', 0, 'OPERATION_STATUS_UNAVAILABLE')
      throw new SimApiError(
        failure.message,
        failure.status,
        failure.code,
        {
          cause: failure.details,
          workspaceId,
          operationId,
          requestId: report?.requestId,
          applied: report?.applied,
        },
        failure.exitCode
      )
    }
    if (report.status !== 'processing') return { report, timedOut: false }
    await sleep(Math.min(delay, Math.max(0, deadline - Date.now())))
    delay = Math.min(10000, delay * 2)
  }
}

export function attachWorkspaceOperationWait(operations: Command): void {
  operations
    .command('wait')
    .argument('<operationId>', 'Operation ID returned by import, fork, push, or pull')
    .allowExcessArguments(false)
    .description(
      'Wait for copy and deployment readiness; exit 3 for configuration, 1 for failure, or 4 for timeout'
    )
    .option('--wait-timeout <seconds>', 'Maximum total wait (default 3600; 0 waits indefinitely)')
    .action(async (operationId: string, options: { waitTimeout?: string }, command: Command) => {
      const timeout = workspaceWaitTimeout(options.waitTimeout)
      const { client, profile } = clientFrom(command)
      const workspaceId = client.requireWorkspace()
      const result = await waitWorkspaceOperation(client, workspaceId, operationId, timeout)
      renderResult(
        'getWorkspaceOperation',
        profile.output,
        result.report,
        CLI_CONTRACT.getWorkspaceOperation ?? {}
      )
      assertWorkspaceOperationOutcome(result.report, result.timedOut)
    })
}
