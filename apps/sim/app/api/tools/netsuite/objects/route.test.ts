/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  execute: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))

vi.mock('@/lib/netsuite/application/list-selector-objects', () => ({
  listNetSuiteSelectorObjects: {
    operation: { id: 'netsuite.selector_objects.list' },
    execute: mocks.execute,
  },
}))

import { POST } from '@/app/api/tools/netsuite/objects/route'

function request(body: unknown, headers: HeadersInit = {}): NextRequest {
  return new NextRequest('http://localhost/api/tools/netsuite/objects', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const validBody = {
  credential: 'cred-1',
  workflowId: 'wf-1',
  kind: 'record_types',
} as const

describe('POST /api/tools/netsuite/objects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })
    mocks.execute.mockResolvedValue({
      objects: [{ id: 'customer', label: 'customer', detail: null }],
    })
  })

  it('authenticates before parsing an invalid body', async () => {
    mocks.getSession.mockResolvedValue(null)

    const response = await POST(request('{not-json'))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({ error: 'Unauthorized' })
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('does not accept an API key as selector authentication', async () => {
    mocks.getSession.mockResolvedValue(null)

    const response = await POST(request(validBody, { 'x-api-key': 'workspace-key' }))

    expect(response.status).toBe(401)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('validates the discriminated selector contract after session auth', async () => {
    const response = await POST(
      request({
        credential: 'cred-1',
        workflowId: 'wf-1',
        kind: 'async_tasks',
      })
    )

    expect(response.status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('maps the bounded body and request signal into the application use case', async () => {
    const req = request(validBody)
    const response = await POST(req)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      objects: [{ id: 'customer', label: 'customer', detail: null }],
    })
    expect(mocks.execute).toHaveBeenCalledWith({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { ...validBody, signal: req.signal },
      request: req,
    })
  })

  it('marks stored-credential failures as reconnectable without exposing internals', async () => {
    mocks.execute.mockRejectedValue(
      new OrchestrationError(
        'unauthorized',
        'Could not resolve the NetSuite credential. Reconnect it and try again.'
      )
    )

    const response = await POST(request(validBody))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Could not resolve the NetSuite credential. Reconnect it and try again.',
      authRequired: true,
    })
  })
})
