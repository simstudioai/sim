import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import {
  executeInIsolatedVM,
  type IsolatedVMBrokerHandler,
  type IsolatedVMExecutionRequest,
} from '@/lib/execution/isolated-vm'
import type { SandboxBrokerContext, SandboxTaskInput } from '@/lib/execution/sandbox/types'
import { getSandboxTask, type SandboxTaskId } from '@/sandbox-tasks/registry'

const logger = createLogger('SandboxRunTask')

export interface RunSandboxTaskOptions {
  /**
   * Owner key used by the isolated-vm pool for fairness + distributed leases.
   * Typically `user:<userId>` or `workspace:<workspaceId>`.
   */
  ownerKey?: string
  /** Optional AbortSignal to cancel the execution early. */
  signal?: AbortSignal
}

/**
 * Executes a sandbox task inside the shared isolated-vm pool and returns the
 * binary result buffer. Throws with a human-readable message if the task fails
 * so callers can propagate the error verbatim to UI.
 */
export async function runSandboxTask<TInput extends SandboxTaskInput>(
  taskId: SandboxTaskId,
  input: TInput,
  options: RunSandboxTaskOptions = {}
): Promise<Buffer> {
  const task = getSandboxTask(taskId)
  const requestId = generateShortId(12)

  const brokerContext: SandboxBrokerContext = {
    workspaceId: input.workspaceId,
    requestId,
  }
  const brokers: Record<string, IsolatedVMBrokerHandler> = {}
  for (const broker of task.brokers) {
    brokers[broker.name] = (args) => broker.handle(brokerContext, args)
  }

  const request: IsolatedVMExecutionRequest = {
    code: input.code,
    params: {},
    envVars: {},
    contextVariables: {},
    timeoutMs: task.timeoutMs,
    requestId,
    ownerKey: options.ownerKey,
    ownerWeight: 1,
    task: {
      id: task.id,
      bundles: [...task.bundles],
      bootstrap: task.bootstrap,
      brokers: task.brokers.map((b) => b.name),
      finalize: task.finalize,
    },
  }

  const start = Date.now()
  const result = await executeInIsolatedVM(request, { brokers, signal: options.signal })
  const elapsedMs = Date.now() - start

  // Phase timings come from the worker (see executeTask). `queue` is the
  // gap between client call and worker-side start — useful for diagnosing
  // pool saturation vs. isolate-internal slowness.
  const queueMs = result.timings ? Math.max(0, elapsedMs - result.timings.total) : undefined

  if (result.error) {
    logger.warn('Sandbox task failed', {
      taskId,
      requestId,
      workspaceId: input.workspaceId,
      elapsedMs,
      queueMs,
      timings: result.timings,
      error: result.error.message,
      errorName: result.error.name,
    })
    const err = new Error(result.error.message)
    err.name = result.error.name || 'SandboxTaskError'
    if (result.error.stack) err.stack = result.error.stack
    throw err
  }

  if (typeof result.bytesBase64 !== 'string' || result.bytesBase64.length === 0) {
    logger.error('Sandbox task returned no bytes', {
      taskId,
      requestId,
      workspaceId: input.workspaceId,
      timings: result.timings,
    })
    throw new Error(`Sandbox task "${taskId}" finalize did not return any bytes`)
  }

  const bytes = Buffer.from(result.bytesBase64, 'base64')
  logger.info('Sandbox task completed', {
    taskId,
    requestId,
    workspaceId: input.workspaceId,
    elapsedMs,
    queueMs,
    timings: result.timings,
    bytes: bytes.length,
  })
  return task.toResult(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), input)
}
