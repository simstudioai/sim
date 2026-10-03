import { vi } from 'vitest'

/** Error body fields the real `APIError` copies onto the instance. */
interface MockOpenAIErrorBody {
  message?: unknown
  code?: string | null
  param?: string | null
  type?: string
}

/**
 * Mirrors the `openai` SDK's `APIError`: same constructor `(status, error, message, headers)`, same
 * `status`/`error`/`code`/`param`/`type`/`headers`/`requestID` fields and the same message format
 * (`'<status> <error.message>'`, falling back to `message`). It is NOT a subclass of the real
 * `APIError`; code checking `instanceof OpenAI.APIError` against the mocked module sees it because
 * the mock exposes this class as `APIError` and as the static `OpenAI.APIError`.
 */
export class MockOpenAIAPIError extends Error {
  readonly status: number | undefined
  readonly headers: Headers | undefined
  readonly error: MockOpenAIErrorBody | undefined
  readonly code: string | null | undefined
  readonly param: string | null | undefined
  readonly type: string | undefined
  readonly requestID: string | null | undefined

  constructor(
    status: number | undefined,
    error: MockOpenAIErrorBody | undefined,
    message: string | undefined,
    headers?: Headers
  ) {
    super(MockOpenAIAPIError.makeMessage(status, error, message))
    this.status = status
    this.headers = headers
    this.requestID = headers?.get('x-request-id')
    this.error = error
    this.code = error?.code
    this.param = error?.param
    this.type = error?.type
  }

  private static makeMessage(
    status: number | undefined,
    error: MockOpenAIErrorBody | undefined,
    message: string | undefined
  ): string {
    const msg = error?.message
      ? typeof error.message === 'string'
        ? error.message
        : JSON.stringify(error.message)
      : error
        ? JSON.stringify(error)
        : message
    if (status && msg) return `${status} ${msg}`
    if (status) return `${status} status code (no body)`
    if (msg) return msg
    return '(no status code or body)'
  }
}

const mockChatCompletionsCreate = vi.fn()
const mockResponsesCreate = vi.fn()
const mockEmbeddingsCreate = vi.fn()

/**
 * Stand-in client class: every instance shares the same `create` mocks, so a test controls the
 * client without capturing the instance.
 */
class MockOpenAIClient {
  chat = { completions: { create: mockChatCompletionsCreate } }
  responses = { create: mockResponsesCreate }
  embeddings = { create: mockEmbeddingsCreate }
}

const mockOpenAI = Object.assign(vi.fn(MockOpenAIClient), { APIError: MockOpenAIAPIError })
const mockAzureOpenAI = vi.fn(MockOpenAIClient)

/**
 * Controllable mock functions for the `openai` SDK.
 *
 * - `mockOpenAI` / `mockAzureOpenAI` are the constructors (`new OpenAI(opts)` /
 *   `new AzureOpenAI(opts)`); their default implementation builds a client whose
 *   `chat.completions.create`, `responses.create` and `embeddings.create` are the shared
 *   `mockChatCompletionsCreate` / `mockResponsesCreate` / `mockEmbeddingsCreate` (bare `vi.fn()`).
 *   Constructor options are recorded as call args: `mockOpenAI.mock.calls[0][0]`.
 *
 * @example
 * ```ts
 * import { openaiMockFns } from '@sim/testing/mocks/openai.mock'
 *
 * openaiMockFns.mockChatCompletionsCreate.mockResolvedValue({ choices: [{ message: { content: 'hi' } }] })
 * expect(openaiMockFns.mockOpenAI).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'k' }))
 * ```
 */
export const openaiMockFns = {
  mockOpenAI,
  mockAzureOpenAI,
  mockChatCompletionsCreate,
  mockResponsesCreate,
  mockEmbeddingsCreate,
}

/**
 * Static mock module for `openai`: the default export and named `OpenAI` are {@link mockOpenAI}
 * (with a static `APIError`), `AzureOpenAI` is {@link mockAzureOpenAI}, and `APIError` is
 * {@link MockOpenAIAPIError}. Other SDK exports (`OpenAIError`, the per-status error subclasses,
 * `toFile`, …) are not provided — no production code imports them at runtime.
 *
 * @example
 * ```ts
 * vi.mock('openai', () => openaiMock)
 * ```
 */
export const openaiMock = {
  default: mockOpenAI,
  OpenAI: mockOpenAI,
  AzureOpenAI: mockAzureOpenAI,
  APIError: MockOpenAIAPIError,
}
