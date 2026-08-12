/**
 * @vitest-environment node
 */
import { getRequestContext } from '@sim/logger'
import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { responseWithRequestId, withRequestId } from '@/lib/api/server/routes/request-id'

const mockGetRequestContext = vi.mocked(getRequestContext)

describe('withRequestId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRequestContext.mockReturnValue(undefined)
  })

  it('stamps the ambient request id onto an error body', () => {
    mockGetRequestContext.mockReturnValue({ requestId: 'req-123' })

    expect(withRequestId({ error: 'Table not found' })).toEqual({
      error: 'Table not found',
      requestId: 'req-123',
    })
  })

  it('leaves the body untouched when there is no active request scope', () => {
    expect(withRequestId({ error: 'Table not found' })).toEqual({ error: 'Table not found' })
  })

  it('does not overwrite a requestId the policy already set', () => {
    mockGetRequestContext.mockReturnValue({ requestId: 'req-123' })

    expect(withRequestId({ error: 'boom', requestId: 'explicit' })).toEqual({
      error: 'boom',
      requestId: 'explicit',
    })
  })

  it('passes through non-object bodies', () => {
    mockGetRequestContext.mockReturnValue({ requestId: 'req-123' })

    expect(withRequestId('plain text')).toBe('plain text')
    expect(withRequestId(null)).toBeNull()
    expect(withRequestId([{ error: 'a' }])).toEqual([{ error: 'a' }])
  })
})

describe('responseWithRequestId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRequestContext.mockReturnValue(undefined)
  })

  it('stamps the request id into an already-built JSON error response', async () => {
    mockGetRequestContext.mockReturnValue({ requestId: 'req-123' })

    const stamped = await responseWithRequestId(
      NextResponse.json({ error: 'Validation error', details: [] }, { status: 400 })
    )

    expect(stamped.status).toBe(400)
    await expect(stamped.json()).resolves.toEqual({
      error: 'Validation error',
      details: [],
      requestId: 'req-123',
    })
  })

  it('preserves headers other than a stale content-length', async () => {
    mockGetRequestContext.mockReturnValue({ requestId: 'req-123' })

    const original = NextResponse.json(
      { error: 'Validation error' },
      { status: 400, headers: { 'x-custom': 'kept', 'content-length': '29' } }
    )
    const stamped = await responseWithRequestId(original)

    expect(stamped.headers.get('x-custom')).toBe('kept')
    expect(stamped.headers.get('content-length')).toBeNull()
  })

  it('returns the original response when there is no active request scope', async () => {
    const original = NextResponse.json({ error: 'Validation error' }, { status: 400 })

    expect(await responseWithRequestId(original)).toBe(original)
  })

  it('returns the original response when the body is not JSON', async () => {
    mockGetRequestContext.mockReturnValue({ requestId: 'req-123' })

    const original = new NextResponse('plain text', {
      status: 400,
      headers: { 'content-type': 'text/plain' },
    })

    expect(await responseWithRequestId(original)).toBe(original)
  })

  it('leaves a response that already carries a requestId untouched', async () => {
    mockGetRequestContext.mockReturnValue({ requestId: 'req-123' })

    const original = NextResponse.json({ error: 'boom', requestId: 'explicit' }, { status: 400 })

    expect(await responseWithRequestId(original)).toBe(original)
  })
})
