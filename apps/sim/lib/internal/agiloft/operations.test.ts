/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SecureFetchResponse } from '@/lib/core/security/input-validation.server'
import type { ToolResponse } from '@/tools/types'

const clientMocks = vi.hoisted(() => ({
  executeAgiloftRequest: vi.fn(),
  executeAlrestRequest: vi.fn(),
  executeEwRequest: vi.fn(),
  isAgiloftRefusal: vi.fn(),
  readAlrestJson: vi.fn(),
  resolveAgiloftInstance: vi.fn(),
}))

const providerMocks = vi.hoisted(() => ({
  secureFetchWithPinnedIP: vi.fn(),
}))

const fileMocks = vi.hoisted(() => ({
  resolveAgiloftAttachmentFile: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  MAX_JSON_API_RESPONSE_BYTES: 10 * 1024 * 1024,
  secureFetchWithPinnedIP: providerMocks.secureFetchWithPinnedIP,
}))
vi.mock('@/lib/internal/agiloft/client', () => clientMocks)
vi.mock('@/lib/internal/agiloft/file-input', () => fileMocks)

import {
  executeAgiloftCreateRecord,
  executeAgiloftRetrieveAttachment,
  executeAgiloftSearchRecords,
  executeAgiloftSelectRecords,
} from '@/lib/internal/agiloft/operations'

const BASE = {
  instanceUrl: 'https://example.agiloft.com',
  knowledgeBase: 'demo',
  login: 'user',
  password: 'not-a-real-password',
  table: 'contracts',
}

function createResponse(
  options: {
    status?: number
    text?: string
    bytes?: Uint8Array
    headers?: Record<string, string>
  } = {}
): SecureFetchResponse {
  const status = options.status ?? 200
  const bytes = options.bytes ?? new TextEncoder().encode(options.text ?? '')
  const headers = new Map(
    Object.entries(options.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value])
  )
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: {
      get: (name: string) => headers.get(name.toLowerCase()) ?? null,
      getSetCookie: () => [],
      toRecord: () => Object.fromEntries(headers),
      [Symbol.iterator]: () => headers.entries(),
    },
    body: null,
    text: async () => new TextDecoder().decode(bytes),
    json: async () => JSON.parse(new TextDecoder().decode(bytes)),
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  }
}

type ResponseTransform = (response: SecureFetchResponse) => Promise<ToolResponse>

describe('Agiloft operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clientMocks.isAgiloftRefusal.mockReturnValue(false)
    clientMocks.resolveAgiloftInstance.mockResolvedValue('203.0.113.10')
  })

  it('rejects invalid record JSON before opening an Agiloft session', async () => {
    const result = await executeAgiloftCreateRecord(
      { ...BASE, data: '[]' },
      { requestId: 'request-1' }
    )

    expect(result).toEqual({
      success: false,
      output: { id: null, fields: {} },
      error: 'The data parameter must be a JSON object of field names to values',
    })
    expect(clientMocks.executeAlrestRequest).not.toHaveBeenCalled()
  })

  it('caps search results and forwards cancellation through the authenticated operation', async () => {
    const controller = new AbortController()
    const records = Array.from({ length: 205 }, (_, id) => ({ id }))
    clientMocks.readAlrestJson.mockResolvedValue(records)
    clientMocks.executeAlrestRequest.mockImplementation(
      async (
        _params: unknown,
        _buildRequest: unknown,
        transformResponse: ResponseTransform,
        _signal?: AbortSignal
      ) => transformResponse(createResponse())
    )

    const result = await executeAgiloftSearchRecords(
      { ...BASE, query: 'status=Open' },
      { requestId: 'request-1', signal: controller.signal }
    )

    expect(result.output).toMatchObject({
      records: records.slice(0, 200),
      totalCount: 200,
      truncated: true,
    })
    expect(clientMocks.executeAlrestRequest.mock.calls[0]?.[3]).toBe(controller.signal)
  })

  it('caps legacy select IDs without materializing them into an unbounded result', async () => {
    const assignments = Array.from(
      { length: 1005 },
      (_, index) => `EWREST_id_${index} = '${index}';`
    ).join('\n')
    clientMocks.executeEwRequest.mockImplementation(
      async (_params: unknown, _buildRequest: unknown, transformResponse: ResponseTransform) =>
        transformResponse(createResponse({ text: assignments }))
    )

    const result = await executeAgiloftSelectRecords(
      { ...BASE, where: 'status=Open' },
      { requestId: 'request-1' }
    )

    expect(result.output).toMatchObject({
      totalCount: 1000,
      truncated: true,
    })
    expect(result.output?.recordIds).toHaveLength(1000)
  })

  it('bounds attachment downloads and preserves binary metadata', async () => {
    const controller = new AbortController()
    providerMocks.secureFetchWithPinnedIP.mockResolvedValue(
      createResponse({
        bytes: new TextEncoder().encode('hello'),
        headers: {
          'content-type': 'text/plain',
          'content-disposition': 'attachment; filename="evidence.txt"',
        },
      })
    )

    const result = await executeAgiloftRetrieveAttachment(
      { ...BASE, recordId: '1', fieldName: 'files', position: '0' },
      { requestId: 'request-1', signal: controller.signal }
    )

    expect(result).toEqual({
      success: true,
      output: {
        file: {
          name: 'evidence.txt',
          mimeType: 'text/plain',
          data: Buffer.from('hello').toString('base64'),
          size: 5,
        },
      },
    })
    expect(providerMocks.secureFetchWithPinnedIP).toHaveBeenCalledWith(
      expect.stringContaining('/ewws/EWRetrieve'),
      '203.0.113.10',
      {
        profile: 'configuredEndpoint',
        method: 'GET',
        maxResponseBytes: 25 * 1024 * 1024,
        signal: controller.signal,
      }
    )
  })
})
