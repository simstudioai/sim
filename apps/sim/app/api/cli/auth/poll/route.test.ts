/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockPollApproval,
  mockCompleteApproval,
  mockReleaseMint,
  mockGenerateCopilotApiKey,
  mockCreatePersonalApiKey,
  mockCreateWorkspaceApiKey,
  mockEnforceIpRateLimit,
} = vi.hoisted(() => ({
  mockPollApproval: vi.fn(),
  mockCompleteApproval: vi.fn(),
  mockReleaseMint: vi.fn(),
  mockGenerateCopilotApiKey: vi.fn(),
  mockCreatePersonalApiKey: vi.fn(),
  mockCreateWorkspaceApiKey: vi.fn(),
  mockEnforceIpRateLimit: vi.fn(),
}))

vi.mock('@/lib/cli-auth/approval-store', () => ({
  pollApproval: mockPollApproval,
  completeApproval: mockCompleteApproval,
  releaseMint: mockReleaseMint,
}))

vi.mock('@/lib/copilot/server/api-keys', () => ({
  generateCopilotApiKey: mockGenerateCopilotApiKey,
  CopilotApiKeyError: class extends Error {},
}))

vi.mock('@/lib/api-key/orchestration', () => ({
  performCreatePersonalApiKey: mockCreatePersonalApiKey,
  performCreateWorkspaceApiKey: mockCreateWorkspaceApiKey,
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  enforceIpRateLimit: mockEnforceIpRateLimit,
}))

import { POST } from '@/app/api/cli/auth/poll/route'

const REQUEST = 'a'.repeat(43)
const VERIFIER = 'b'.repeat(43)

function pollRequest(body: Record<string, unknown>) {
  return createMockRequest('POST', body)
}

/** What `pollApproval` returns for an approval recorded at the given scope. */
function approved(overrides: Record<string, unknown> = {}) {
  return {
    status: 'approved',
    userId: 'user-1',
    scope: 'copilot',
    workspaceId: null,
    workspaceBound: false,
    ...overrides,
  }
}

describe('POST /api/cli/auth/poll', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnforceIpRateLimit.mockResolvedValue(null)
    mockGenerateCopilotApiKey.mockResolvedValue({ id: 'key-1', apiKey: 'sk-test' })
    mockCreatePersonalApiKey.mockResolvedValue({
      success: true,
      key: { id: 'key-2', name: 'CLI', key: 'sim_personal', createdAt: new Date() },
    })
    mockCreateWorkspaceApiKey.mockResolvedValue({
      success: true,
      key: { id: 'key-3', name: 'CLI', key: 'sim_workspace', createdAt: new Date() },
    })
    mockCompleteApproval.mockResolvedValue(undefined)
    mockReleaseMint.mockResolvedValue(undefined)
  })

  it('returns pending without minting while unapproved', async () => {
    mockPollApproval.mockResolvedValue({ status: 'pending' })
    const response = await POST(pollRequest({ request: REQUEST, verifier: VERIFIER }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'pending' })
    expect(mockGenerateCopilotApiKey).not.toHaveBeenCalled()
  })

  it('mints, then consumes the approval, once approved', async () => {
    mockPollApproval.mockResolvedValue(approved())
    const response = await POST(pollRequest({ request: REQUEST, verifier: VERIFIER }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: 'complete',
      key: { id: 'key-1', apiKey: 'sk-test' },
      scope: 'copilot',
      workspaceId: null,
      workspaceBound: false,
    })
    expect(mockGenerateCopilotApiKey).toHaveBeenCalledWith('user-1', expect.stringMatching(/^CLI /))
    expect(mockCompleteApproval).toHaveBeenCalledWith(REQUEST)
    expect(mockReleaseMint).not.toHaveBeenCalled()
  })

  it('mints a personal platform key when the approval carries no workspace', async () => {
    mockPollApproval.mockResolvedValue(approved({ scope: 'platform' }))
    const response = await POST(pollRequest({ request: REQUEST, verifier: VERIFIER }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: 'complete',
      key: { id: 'key-2', apiKey: 'sim_personal' },
      scope: 'platform',
      workspaceId: null,
      workspaceBound: false,
    })
    expect(mockCreatePersonalApiKey).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', source: 'cli' })
    )
    expect(mockGenerateCopilotApiKey).not.toHaveBeenCalled()
  })

  it('mints a workspace-scoped key when the approval carries a workspace', async () => {
    mockPollApproval.mockResolvedValue(
      approved({ scope: 'platform', workspaceId: 'ws-1', workspaceBound: true })
    )
    const response = await POST(pollRequest({ request: REQUEST, verifier: VERIFIER }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: 'complete',
      key: { id: 'key-3', apiKey: 'sim_workspace' },
      scope: 'platform',
      workspaceId: 'ws-1',
      workspaceBound: true,
    })
    expect(mockCreateWorkspaceApiKey).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', workspaceId: 'ws-1', source: 'cli' })
    )
    expect(mockCreatePersonalApiKey).not.toHaveBeenCalled()
  })

  it('returns the picked workspace with a personal key when the approval is unbound', async () => {
    // A non-admin still picked a workspace in the browser; the terminal needs it
    // as its default even though the key is not scoped to it.
    mockPollApproval.mockResolvedValue(approved({ scope: 'platform', workspaceId: 'ws-1' }))
    const response = await POST(pollRequest({ request: REQUEST, verifier: VERIFIER }))
    await expect(response.json()).resolves.toEqual({
      status: 'complete',
      key: { id: 'key-2', apiKey: 'sim_personal' },
      scope: 'platform',
      workspaceId: 'ws-1',
      workspaceBound: false,
    })
    expect(mockCreatePersonalApiKey).toHaveBeenCalled()
    expect(mockCreateWorkspaceApiKey).not.toHaveBeenCalled()
  })

  it('scope comes from the approval, never from the poll body', async () => {
    mockPollApproval.mockResolvedValue(approved({ scope: 'copilot' }))
    const response = await POST(
      pollRequest({ request: REQUEST, verifier: VERIFIER, scope: 'platform' })
    )
    await expect(response.json()).resolves.toMatchObject({ scope: 'copilot' })
    expect(mockCreatePersonalApiKey).not.toHaveBeenCalled()
  })

  it('releases the reservation (keeps the approval) when minting fails', async () => {
    mockPollApproval.mockResolvedValue(approved())
    mockGenerateCopilotApiKey.mockRejectedValue(new Error('mothership down'))
    const response = await POST(pollRequest({ request: REQUEST, verifier: VERIFIER }))
    expect(response.status).toBe(500)
    expect(mockReleaseMint).toHaveBeenCalledWith(REQUEST)
    expect(mockCompleteApproval).not.toHaveBeenCalled()
  })

  it('releases the reservation when a platform mint fails', async () => {
    mockPollApproval.mockResolvedValue(approved({ scope: 'platform' }))
    mockCreatePersonalApiKey.mockResolvedValue({
      success: false,
      errorCode: 'conflict',
      error: 'A personal API key named "CLI" already exists.',
    })
    const response = await POST(pollRequest({ request: REQUEST, verifier: VERIFIER }))
    expect(response.status).toBe(409)
    expect(mockReleaseMint).toHaveBeenCalledWith(REQUEST)
    expect(mockCompleteApproval).not.toHaveBeenCalled()
  })

  it('still returns the key when post-mint cleanup fails — never releases the lock', async () => {
    mockPollApproval.mockResolvedValue(approved())
    mockCompleteApproval.mockRejectedValue(new Error('redis blip'))
    const response = await POST(pollRequest({ request: REQUEST, verifier: VERIFIER }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: 'complete',
      key: { id: 'key-1', apiKey: 'sk-test' },
      scope: 'copilot',
      workspaceId: null,
      workspaceBound: false,
    })
    // A cleanup failure must not release the mint lock — that would allow a re-mint.
    expect(mockReleaseMint).not.toHaveBeenCalled()
  })

  it('rejects a malformed verifier before touching the store', async () => {
    const response = await POST(pollRequest({ request: REQUEST, verifier: 'too-short' }))
    expect(response.status).toBe(400)
    expect(mockPollApproval).not.toHaveBeenCalled()
  })

  it('honors the IP rate limiter', async () => {
    mockEnforceIpRateLimit.mockResolvedValue(
      new Response(null, { status: 429 }) as unknown as never
    )
    const response = await POST(pollRequest({ request: REQUEST, verifier: VERIFIER }))
    expect(response.status).toBe(429)
    expect(mockPollApproval).not.toHaveBeenCalled()
  })
})
