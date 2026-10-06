import { authMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DesktopDeviceUnrecognizedError } from '@/lib/desktop/executor/errors'

const { admitted, stored, admitError } = vi.hoisted(() => ({
  /** Entries the route admitted, in order. */
  admitted: [] as Array<Record<string, unknown>>,
  /** Entries the route stored, with how many bytes each file carried. */
  stored: [] as Array<{ executionToken: unknown; bytes: number | null }>,
  admitError: { next: null as Error | null },
}))

vi.mock('@/lib/desktop/application/import', () => ({
  admitDesktopImportEntry: async (_principal: unknown, input: Record<string, unknown>) => {
    const error = admitError.next
    admitError.next = null
    if (error) throw error
    admitted.push(input)
  },
  importDesktopEntry: {
    execute: async ({ input }: { input: { executionToken: unknown; content?: Buffer } }) => {
      stored.push({
        executionToken: input.executionToken,
        bytes: input.content ? input.content.length : null,
      })
      return { id: 'file-1', name: 'notes.txt' }
    },
  },
}))

import { PUT } from '@/app/api/desktop/tool/import/route'

const DEVICE = '00000000-0000-4000-8000-000000000001'
const QUERY = `deviceId=${DEVICE}&toolCallId=call-1&kind=file&sourceName=Reports&relativePath=notes.txt`

/** A request whose body counts how much of it the route read. */
function put(options: {
  body?: Uint8Array
  length?: string | null
  token?: string | null
  host?: string
  query?: string
}) {
  const body = options.body ?? new TextEncoder().encode('hello')
  let pulled = 0
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulled += 1
        controller.enqueue(body)
        controller.close()
      },
    },
    // Pulled only when the route reads it, never ahead of time.
    { highWaterMark: 0 }
  )
  const headers: Record<string, string> = {}
  const length = options.length === undefined ? String(body.byteLength) : options.length
  if (length !== null) headers['content-length'] = length
  if (options.token !== null) headers['x-sim-execution-token'] = options.token ?? 'token-1'
  if (options.host) headers.host = options.host
  const request = new NextRequest(
    `http://${options.host ?? 'localhost'}/api/desktop/tool/import?${options.query ?? QUERY}`,
    { method: 'PUT', headers, body: stream, duplex: 'half' }
  )
  return { request, pulled: () => pulled }
}

describe('PUT /api/desktop/tool/import', () => {
  beforeEach(() => {
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'u1' },
      session: { id: 's1' },
    })
    admitted.length = 0
    stored.length = 0
    admitError.next = null
  })

  it('stores a whole file under the claim the token header names', async () => {
    const { request } = put({})

    const response = await PUT(request, {})

    expect(response.status).toBe(200)
    expect(stored).toEqual([{ executionToken: 'token-1', bytes: 5 }])
  })

  it('refuses a body that does not match its declared length, storing nothing', async () => {
    const { request } = put({ length: '10' })

    const response = await PUT(request, {})

    expect(response.status).toBe(400)
    expect(stored).toEqual([])
  })

  it('refuses a file that does not declare its length', async () => {
    const { request } = put({ length: null })

    expect((await PUT(request, {})).status).toBe(411)
    expect(stored).toEqual([])
  })

  it('refuses a file over the import limit before admitting it', async () => {
    const { request, pulled } = put({ length: String(65 * 1024 * 1024) })

    expect((await PUT(request, {})).status).toBe(413)
    expect(admitted).toEqual([])
    expect(pulled()).toBe(0)
  })

  it('reads no body for an entry it does not admit', async () => {
    admitError.next = new DesktopDeviceUnrecognizedError()
    const { request, pulled } = put({})

    const response = await PUT(request, {})

    expect(response.status).toBe(401)
    expect(pulled()).toBe(0)
    expect(stored).toEqual([])
  })

  it('answers an unauthenticated request with 401', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce(null)
    const { request } = put({})

    expect((await PUT(request, {})).status).toBe(401)
    expect(admitted).toEqual([])
  })

  it('refuses a request without the execution token header', async () => {
    const { request } = put({ token: null })

    expect((await PUT(request, {})).status).toBe(400)
    expect(admitted).toEqual([])
  })

  it('refuses a name a workspace cannot store before admitting it', async () => {
    const { request } = put({
      query: `deviceId=${DEVICE}&toolCallId=call-1&kind=file&sourceName=Reports&relativePath=${encodeURIComponent('.. /notes.txt')}`,
    })

    expect((await PUT(request, {})).status).toBe(400)
    expect(admitted).toEqual([])
  })
})
