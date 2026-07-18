/**
 * @vitest-environment node
 */
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockSelect,
  mockLimit,
  mockRequireHop,
  mockVerifyAbuseToken,
  mockEnforceIpLimit,
  mockEnforceActionLimit,
  mockTryAdmit,
  mockReleaseTicket,
  mockValidateInput,
  mockExecuteDeployedAction,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockLimit: vi.fn(),
  mockRequireHop: vi.fn(),
  mockVerifyAbuseToken: vi.fn(),
  mockEnforceIpLimit: vi.fn(),
  mockEnforceActionLimit: vi.fn(),
  mockTryAdmit: vi.fn(),
  mockReleaseTicket: vi.fn(),
  mockValidateInput: vi.fn(),
  mockExecuteDeployedAction: vi.fn(),
}))

vi.mock('@sim/db', () => ({ db: { select: mockSelect } }))
vi.mock('@/lib/apps/hop-proof', () => ({ requireAppsHopFromRequest: mockRequireHop }))
vi.mock('@/lib/apps/abuse-token', () => ({ verifyAppsAbuseToken: mockVerifyAbuseToken }))
vi.mock('@/lib/apps/rate-limit', () => ({
  enforceAppsIpRateLimit: mockEnforceIpLimit,
  enforceAppsActionRateLimit: mockEnforceActionLimit,
}))
vi.mock('@/lib/apps/schema-validate', () => ({ validateAppActionInput: mockValidateInput }))
vi.mock('@/lib/apps/execute-deployed-action', () => ({
  executeDeployedAction: mockExecuteDeployedAction,
}))
vi.mock('@/lib/core/admission/gate', () => ({
  tryAdmit: mockTryAdmit,
  admissionRejectedResponse: () => NextResponse.json({ error: 'At capacity' }, { status: 429 }),
}))

import { POST } from '@/app/api/apps/gateway/releases/[releaseId]/actions/[actionId]/route'

const release = {
  id: 'release-1',
  projectId: 'project-1',
  state: 'published',
  revokedAt: null,
}
const project = {
  id: 'project-1',
  workspaceId: 'ws-1',
  publicId: 'public-1',
  publishedReleaseId: 'release-1',
}

function request(abuseToken?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (abuseToken) headers['x-sim-app-abuse-token'] = abuseToken
  return new NextRequest(
    'http://localhost/api/apps/gateway/releases/release-1/actions/submit',
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ input: { name: 'Ada' } }),
    }
  )
}

function callPost(abuseToken?: string) {
  return POST(request(abuseToken), {
    params: Promise.resolve({ releaseId: 'release-1', actionId: 'submit' }),
  })
}

describe('POST apps gateway action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: mockLimit }),
      }),
    })
    mockRequireHop.mockReturnValue({ ok: true })
    mockEnforceIpLimit.mockResolvedValue(null)
    mockEnforceActionLimit.mockResolvedValue(null)
    mockTryAdmit.mockReturnValue({ release: mockReleaseTicket })
    mockVerifyAbuseToken.mockReturnValue({
      ok: true,
      claims: { publicId: 'public-1', visitorId: 'visitor-1', exp: Date.now() + 60_000 },
    })
    mockValidateInput.mockReturnValue({ ok: true })
    mockExecuteDeployedAction.mockResolvedValue({
      success: true,
      executionId: 'execution-1',
      status: 'completed',
      outputs: { greeting: 'Hello Ada' },
      rawResult: {},
    })
  })

  it('rejects requests without trusted hop proof', async () => {
    mockRequireHop.mockReturnValueOnce({ ok: false, status: 403, message: 'Forbidden' })

    const response = await callPost()

    expect(response.status).toBe(403)
    expect(mockEnforceIpLimit).not.toHaveBeenCalled()
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('returns 404 when the release is not the current pointer', async () => {
    mockLimit
      .mockResolvedValueOnce([release])
      .mockResolvedValueOnce([{ ...project, publishedReleaseId: 'other-release' }])

    const response = await callPost()

    expect(response.status).toBe(404)
    expect(mockVerifyAbuseToken).not.toHaveBeenCalled()
  })

  it('returns 404 for a revoked release', async () => {
    mockLimit.mockResolvedValueOnce([
      { ...release, state: 'revoked', revokedAt: new Date('2026-01-01T00:00:00Z') },
    ])

    const response = await callPost()

    expect(response.status).toBe(404)
    expect(mockVerifyAbuseToken).not.toHaveBeenCalled()
  })

  it('returns 404 when the project is archived or unavailable', async () => {
    mockLimit.mockResolvedValueOnce([release]).mockResolvedValueOnce([])

    const response = await callPost()

    expect(response.status).toBe(404)
    expect(mockVerifyAbuseToken).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', undefined],
    ['invalid', 'invalid-token'],
  ])('rejects a %s abuse token', async (_label, token) => {
    mockLimit.mockResolvedValueOnce([release]).mockResolvedValueOnce([project])
    mockVerifyAbuseToken.mockReturnValueOnce({ ok: false })

    const response = await callPost(token)

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: 'Abuse challenge required',
      code: 'ABUSE_TOKEN_REQUIRED',
    })
    expect(mockExecuteDeployedAction).not.toHaveBeenCalled()
  })

  it('fails closed with 429 when the IP rate limiter denies the request', async () => {
    mockEnforceIpLimit.mockResolvedValueOnce(
      NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
    )

    const response = await callPost()

    expect(response.status).toBe(429)
    expect(mockTryAdmit).not.toHaveBeenCalled()
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('fails closed with 429 when the action rate limiter denies the request', async () => {
    mockEnforceActionLimit.mockResolvedValueOnce(
      NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
    )

    const response = await callPost()

    expect(response.status).toBe(429)
    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockReleaseTicket).toHaveBeenCalledOnce()
  })

  it('executes a current pinned action after all gateway checks pass', async () => {
    mockLimit
      .mockResolvedValueOnce([release])
      .mockResolvedValueOnce([project])
      .mockResolvedValueOnce([
        {
          actionId: 'submit',
          workflowId: 'wf-1',
          deploymentVersionId: 'dv-1',
          schemaHash: 'schema-hash',
          inputSchema: { type: 'object' },
          outputAllowlist: [{ key: 'greeting', blockId: 'result', path: 'text' }],
          executionPolicy: 'sync',
        },
      ])
      .mockResolvedValueOnce([{ id: 'pin-1' }])
      .mockResolvedValueOnce([
        { id: 'wf-1', userId: 'owner-1', workspaceId: 'ws-1', archivedAt: null },
      ])
      .mockResolvedValueOnce([{ id: 'ws-1', archivedAt: null }])

    const response = await callPost('valid-token')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      executionId: 'execution-1',
      outputs: { greeting: 'Hello Ada' },
    })
    expect(mockExecuteDeployedAction).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'wf-1',
        deploymentGate: 'pinned',
        deploymentVersionId: 'dv-1',
        triggerIdentity: 'app',
      })
    )
    expect(mockReleaseTicket).toHaveBeenCalledOnce()
  })
})
