/**
 * @vitest-environment node
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetch, mockResolveCredentialBundle } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockResolveCredentialBundle: vi.fn(),
}))

vi.mock('@/lib/selectors/server/providers/credential-bundle', () => ({
  resolveSelectorCredentialBundle: mockResolveCredentialBundle,
}))

import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { snowflakeSelectorAttachments } from '@/lib/selectors/server/providers/snowflake'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

const STATEMENT_HANDLE = '019c06a4-0000-df4f-0000-00100006589e'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function tableArgs(signal?: AbortSignal): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'snowflake.tables',
    context: {
      oauthCredential: 'credential-1',
      database: 'ANALYTICS',
      schema: 'PUBLIC',
    },
    request: { kind: 'list' },
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    credential: { suppliedId: 'credential-1' },
    references: new Map(),
    signal,
    protectedValues: createSelectorProtectedValues(),
  }
}

describe('Snowflake server selector adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockResolveCredentialBundle.mockResolvedValue({
      accessToken: 'server-only-token',
      domain: 'acme.snowflakecomputing.com',
    })
  })

  afterAll(() => vi.unstubAllGlobals())

  it('returns every advertised result partition in order', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          statementHandle: STATEMENT_HANDLE,
          data: [['ALPHA', 'first']],
          resultSetMetaData: {
            numRows: 3,
            partitionInfo: [{ rowCount: 1 }, { rowCount: 2 }],
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            ['BETA', null],
            ['GAMMA', 'third'],
          ],
        })
      )

    await expect(
      snowflakeSelectorAttachments['snowflake.tables'].execute(tableArgs())
    ).resolves.toEqual({
      kind: 'list',
      items: [
        {
          id: 'ALPHA',
          label: 'ALPHA — first',
          meta: { name: 'ALPHA', detail: 'first' },
        },
        { id: 'BETA', label: 'BETA', meta: { name: 'BETA' } },
        {
          id: 'GAMMA',
          label: 'GAMMA — third',
          meta: { name: 'GAMMA', detail: 'third' },
        },
      ],
    })

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(String(mockFetch.mock.calls[1]?.[0])).toBe(
      `https://acme.snowflakecomputing.com/api/v2/statements/${STATEMENT_HANDLE}?partition=1`
    )
    expect(mockFetch.mock.calls[1]?.[1]).toMatchObject({ method: 'GET', redirect: 'error' })
  })

  it('rejects the whole selector when a later partition fails', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          statementHandle: STATEMENT_HANDLE,
          data: [['ALPHA', null]],
          resultSetMetaData: {
            numRows: 2,
            partitionInfo: [{ rowCount: 1 }, { rowCount: 1 }],
          },
        })
      )
      .mockResolvedValueOnce(jsonResponse({ message: 'private provider payload' }, 500))

    await expect(
      snowflakeSelectorAttachments['snowflake.tables'].execute(tableArgs())
    ).rejects.toMatchObject({
      name: 'SelectorOptionsUnavailableError',
      message: 'Options unavailable',
      status: 502,
    })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('preserves caller cancellation during a later partition', async () => {
    const controller = new AbortController()
    const abortError = new DOMException('The operation was aborted', 'AbortError')
    let markLaterFetchStarted: (() => void) | undefined
    const laterFetchStarted = new Promise<void>((resolve) => {
      markLaterFetchStarted = resolve
    })
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          statementHandle: STATEMENT_HANDLE,
          data: [['ALPHA', null]],
          resultSetMetaData: {
            numRows: 3,
            partitionInfo: [{ rowCount: 1 }, { rowCount: 1 }, { rowCount: 1 }],
          },
        })
      )
      .mockImplementationOnce((_input: RequestInfo | URL, init?: RequestInit) => {
        markLaterFetchStarted?.()
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        })
      })

    const execution = snowflakeSelectorAttachments['snowflake.tables'].execute(
      tableArgs(controller.signal)
    )
    await laterFetchStarted
    controller.abort(abortError)

    await expect(execution).rejects.toBe(abortError)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it.each([
    {
      name: 'missing partition metadata',
      body: {
        statementHandle: STATEMENT_HANDLE,
        data: [['ALPHA', null]],
        resultSetMetaData: { numRows: 1 },
      },
    },
    {
      name: 'more than 16 partitions',
      body: {
        statementHandle: STATEMENT_HANDLE,
        data: [['ALPHA', null]],
        resultSetMetaData: {
          numRows: 1,
          partitionInfo: Array.from({ length: 17 }, () => ({ rowCount: 0 })),
        },
      },
    },
    {
      name: 'more than 1,000 rows',
      body: {
        statementHandle: STATEMENT_HANDLE,
        data: [['ALPHA', null]],
        resultSetMetaData: { numRows: 1_001, partitionInfo: [{ rowCount: 1 }] },
      },
    },
    {
      name: 'an invalid handle for a partitioned result',
      body: {
        statementHandle: '../untrusted-handle',
        data: [['ALPHA', null]],
        resultSetMetaData: {
          numRows: 2,
          partitionInfo: [{ rowCount: 1 }, { rowCount: 1 }],
        },
      },
    },
  ])('rejects $name before requesting more data', async ({ body }) => {
    mockFetch.mockResolvedValueOnce(jsonResponse(body))

    await expect(
      snowflakeSelectorAttachments['snowflake.tables'].execute(tableArgs())
    ).rejects.toMatchObject({
      name: 'SelectorOptionsUnavailableError',
      message: 'Options unavailable',
      status: 502,
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
