import { vi } from 'vitest'

/**
 * Mirrors `ApiError` from `@trigger.dev/sdk` (re-exported from `@trigger.dev/core/v3`): same
 * constructor `(status, error, message, headers)`, `name` (`TriggerApiError`), `status`,
 * `headers`, `error`, `code`, `param`, `type` and message rules, so `instanceof ApiError` against
 * the mocked export and `error.status` checks behave like production.
 */
export class MockTriggerApiError extends Error {
  readonly status: number | undefined
  readonly headers: Record<string, string> | undefined
  readonly error: Record<string, unknown> | undefined
  readonly code: unknown
  readonly param: unknown
  readonly type: unknown

  constructor(
    status: number | undefined,
    error?: unknown,
    message?: string,
    headers?: Record<string, string>
  ) {
    super(MockTriggerApiError.makeMessage(status, error, message))
    this.name = 'TriggerApiError'
    this.status = status
    this.headers = headers
    const data = error as Record<string, unknown> | undefined
    this.error = data
    this.code = data?.code
    this.param = data?.param
    this.type = data?.type
  }

  private static makeMessage(status: number | undefined, error: unknown, message?: string) {
    const record = error as { message?: unknown } | undefined
    const errorMessage = record?.message
      ? typeof record.message === 'string'
        ? record.message
        : JSON.stringify(record.message)
      : typeof error === 'string'
        ? error
        : error
          ? JSON.stringify(error)
          : undefined
    if (errorMessage) return errorMessage
    if (status && message) return `${status} ${message}`
    if (status) return `${status} status code (no body)`
    if (message) return message
    return '(no status code or body)'
  }
}

/** Mirrors `AbortTaskRunError`: a plain `Error` named `AbortTaskRunError`. */
export class MockAbortTaskRunError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AbortTaskRunError'
  }
}

/** Real `timeout.None` (`MAXIMUM_MAX_DURATION`). */
const MAXIMUM_MAX_DURATION = 2_147_483_647

/** An empty `runs.list` page: awaitable-free, `data: []`, and async-iterable like the real `CursorPage`. */
function emptyRunsPage() {
  return {
    data: [] as unknown[],
    async *[Symbol.asyncIterator]() {},
  }
}

/**
 * The task handle `task()`/`schemaTask()` return: the definition itself (so a test can call
 * `.run(payload, ctx)` directly) plus the handle methods, each a fresh `vi.fn()` per task.
 */
function createMockTask<T extends object>(config: T) {
  return {
    ...config,
    trigger: vi.fn(async () => ({ id: 'mock-task-id' })),
    batchTrigger: vi.fn(async () => ({ batchId: 'mock-batch-id', runCount: 0 })),
    triggerAndWait: vi.fn(),
    batchTriggerAndWait: vi.fn(),
  }
}

/**
 * Controllable mock functions for `@trigger.dev/sdk` (globally mocked in `apps/sim/vitest.setup.ts`).
 *
 * Defaults:
 * - `mockTask` / `mockSchemaTask` return the task config spread with `trigger` / `batchTrigger` /
 *   `triggerAndWait` / `batchTriggerAndWait` spies, so `myTask.run(payload, ctx)` reaches the real
 *   handler and `myTask.trigger(...)` resolves `{ id: 'mock-task-id' }`. Definitions run at import
 *   time, so read them from `mockTask.mock.calls` only if the call history was not cleared — prefer
 *   calling `.run` on the imported task.
 * - `mockQueue` returns its config (identity), like the real `queue()` definition helper.
 * - `mockTasksTrigger` resolves `{ id: 'mock-task-id' }`; `mockTasksBatchTrigger` resolves
 *   `[{ id: 'mock-task-id' }]`; `mockTasksBatchTriggerAndWait` resolves `{ id: 'mock-batch-id', runs: [] }`.
 * - `mockRunsRetrieve` resolves `{ id: 'mock-run-id', status: 'COMPLETED' }`; `mockRunsList` returns an
 *   empty async-iterable page; `mockRunsCancel` resolves `{ id }`.
 * - `mockIdempotencyKeysCreate` resolves its key unchanged (the real one hashes it).
 *
 * @example
 * ```ts
 * import { triggerSdkMockFns } from '@sim/testing/mocks/trigger-sdk.mock'
 *
 * triggerSdkMockFns.mockRunsCancel.mockRejectedValueOnce(new Error('gone'))
 * expect(triggerSdkMockFns.mockTasksTrigger).toHaveBeenCalledWith('workflow-execution', payload, expect.anything())
 * ```
 */
export const triggerSdkMockFns = {
  mockTask: vi.fn(<T extends object>(config: T) => createMockTask(config)),
  mockSchemaTask: vi.fn(<T extends object>(config: T) => createMockTask(config)),
  mockQueue: vi.fn(<T>(config: T): T => config),
  mockConfigure: vi.fn(),
  mockTasksTrigger: vi.fn(
    async (_taskId: string, _payload?: unknown, _options?: unknown): Promise<unknown> => ({
      id: 'mock-task-id',
    })
  ),
  mockTasksBatchTrigger: vi.fn(
    async (_taskId: string, _items?: unknown, _options?: unknown): Promise<unknown> => [
      { id: 'mock-task-id' },
    ]
  ),
  mockTasksTriggerAndWait: vi.fn(),
  mockTasksBatchTriggerAndWait: vi.fn(
    async (_taskId: string, _items?: unknown, _options?: unknown): Promise<unknown> => ({
      id: 'mock-batch-id',
      runs: [],
    })
  ),
  mockRunsRetrieve: vi.fn(
    async (_runId: string): Promise<unknown> => ({ id: 'mock-run-id', status: 'COMPLETED' })
  ),
  mockRunsList: vi.fn((_query?: unknown): unknown => emptyRunsPage()),
  mockRunsCancel: vi.fn(async (runId: string): Promise<unknown> => ({ id: runId })),
  mockRunsReplay: vi.fn(),
  mockRunsReschedule: vi.fn(),
  mockRunsPoll: vi.fn(),
  mockIdempotencyKeysCreate: vi.fn(async (key: string | string[], _options?: unknown) => key),
}

/**
 * Static mock module for `@trigger.dev/sdk`. Installed globally by `apps/sim/vitest.setup.ts` —
 * drive it through {@link triggerSdkMockFns}, never re-mock it. `timeout.None` carries the real
 * value; `ApiError` / `AbortTaskRunError` are faithful classes ({@link MockTriggerApiError},
 * {@link MockAbortTaskRunError}).
 *
 * @example
 * ```ts
 * vi.mock('@trigger.dev/sdk', () => triggerSdkMock)
 * ```
 */
export const triggerSdkMock = {
  task: triggerSdkMockFns.mockTask,
  schemaTask: triggerSdkMockFns.mockSchemaTask,
  queue: triggerSdkMockFns.mockQueue,
  configure: triggerSdkMockFns.mockConfigure,
  timeout: { None: MAXIMUM_MAX_DURATION },
  tasks: {
    trigger: triggerSdkMockFns.mockTasksTrigger,
    batchTrigger: triggerSdkMockFns.mockTasksBatchTrigger,
    triggerAndWait: triggerSdkMockFns.mockTasksTriggerAndWait,
    batchTriggerAndWait: triggerSdkMockFns.mockTasksBatchTriggerAndWait,
  },
  runs: {
    retrieve: triggerSdkMockFns.mockRunsRetrieve,
    list: triggerSdkMockFns.mockRunsList,
    cancel: triggerSdkMockFns.mockRunsCancel,
    replay: triggerSdkMockFns.mockRunsReplay,
    reschedule: triggerSdkMockFns.mockRunsReschedule,
    poll: triggerSdkMockFns.mockRunsPoll,
  },
  idempotencyKeys: {
    create: triggerSdkMockFns.mockIdempotencyKeysCreate,
  },
  ApiError: MockTriggerApiError,
  AbortTaskRunError: MockAbortTaskRunError,
}
