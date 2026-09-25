import { vi } from 'vitest'

/** The contract fields `contractUrl` reads. */
interface ContractLike {
  path: string
}

/** The request input fields `contractUrl` reads. */
interface ContractInputLike {
  params?: unknown
  query?: unknown
}

function replacePathParams(path: string, params: unknown): string {
  if (!params || typeof params !== 'object') return path
  const values = params as Record<string, unknown>
  return path.replace(
    /\[\[?(\.\.\.)?([^\][]+)\]\]?/g,
    (match, rest: string | undefined, key: string) => {
      const value = values[key]
      if (rest && Array.isArray(value)) {
        return value.map((item) => encodeURIComponent(String(item))).join('/')
      }
      if (value === undefined && match.startsWith('[[...')) return ''
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        throw new Error(`Missing route param "${key}"`)
      }
      return encodeURIComponent(String(value))
    }
  )
}

function appendQuery(path: string, query: unknown): string {
  if (!query || typeof query !== 'object') return path
  const searchParams = new URLSearchParams()
  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      if (value.some((item) => item !== null && typeof item === 'object')) {
        searchParams.set(key, JSON.stringify(value))
        continue
      }
      for (const item of value) {
        if (item === undefined || item === null || item === '') continue
        searchParams.append(key, String(item))
      }
      continue
    }
    searchParams.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
  }
  const queryString = searchParams.toString()
  if (!queryString) return path
  return `${path}${path.includes('?') ? '&' : '?'}${queryString}`
}

/**
 * Controllable mock functions for `@/lib/api/client/request`.
 *
 * `mockRequestJson`/`mockRequestRaw` are bare `vi.fn()`s: set the response per test.
 * `mockContractUrl` defaults to the real path-param substitution and query encoding, minus the
 * contract's Zod validation (inputs are used as given).
 *
 * @example
 * ```ts
 * import { apiClientRequestMockFns } from '@sim/testing/mocks/api-client-request.mock'
 *
 * apiClientRequestMockFns.mockRequestJson.mockResolvedValue({ workflows: [] })
 * expect(apiClientRequestMockFns.mockRequestJson).toHaveBeenCalledWith(
 *   listWorkflowsContract,
 *   expect.objectContaining({ query: { workspaceId: 'workspace-1' } })
 * )
 * ```
 */
export const apiClientRequestMockFns = {
  mockRequestJson: vi.fn(),
  mockRequestRaw: vi.fn(),
  mockContractUrl: vi.fn((contract: ContractLike, input: ContractInputLike): string =>
    appendQuery(replacePathParams(contract.path, input.params), input.query)
  ),
}

/**
 * Static mock module for `@/lib/api/client/request`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/api/client/request', () => apiClientRequestMock)
 * ```
 */
export const apiClientRequestMock = {
  requestJson: apiClientRequestMockFns.mockRequestJson,
  requestRaw: apiClientRequestMockFns.mockRequestRaw,
  contractUrl: apiClientRequestMockFns.mockContractUrl,
}
