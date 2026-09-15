/**
 * @vitest-environment node
 */
import { loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { captureRequestAttribution } from '@/lib/core/utils/request-attribution'

describe('captureRequestAttribution', () => {
  beforeEach(() => {
    vi.mocked(loggerMock.getRequestContext).mockReset()
  })

  it('carries the client and auth of the request that queues the work', () => {
    vi.mocked(loggerMock.getRequestContext).mockReturnValue({
      requestId: 'req-1',
      path: '/api/workflows/wf-1/execute',
      client: { surface: 'cli', version: '2.1.2', agent: 'none', source: 'header' },
      auth: { kind: 'oauth_access_token', clientId: 'sim-cli' },
    })

    expect(captureRequestAttribution()).toEqual({
      client: { surface: 'cli', version: '2.1.2', agent: 'none', source: 'header' },
      auth: { kind: 'oauth_access_token', clientId: 'sim-cli' },
    })
  })

  it('omits what the request did not establish', () => {
    vi.mocked(loggerMock.getRequestContext).mockReturnValue({
      requestId: 'req-1',
      client: { surface: 'api', source: 'credential' },
    })

    expect(captureRequestAttribution()).toEqual({
      client: { surface: 'api', source: 'credential' },
    })
  })

  it('carries nothing outside a request', () => {
    vi.mocked(loggerMock.getRequestContext).mockReturnValue(undefined)

    expect(captureRequestAttribution()).toBeUndefined()
  })
})
