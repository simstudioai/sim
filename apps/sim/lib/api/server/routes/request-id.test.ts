/**
 * @vitest-environment node
 */
import { getRequestContext } from '@sim/logger'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withRequestId } from '@/lib/api/server/routes/request-id'

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
