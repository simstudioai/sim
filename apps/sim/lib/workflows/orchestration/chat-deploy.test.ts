/**
 * @vitest-environment node
 */
import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetWorkflowDeploymentSummary, mockPerformFullDeploy, mockCheckNeedsRedeployment } =
  vi.hoisted(() => ({
    mockGetWorkflowDeploymentSummary: vi.fn(),
    mockPerformFullDeploy: vi.fn(),
    mockCheckNeedsRedeployment: vi.fn(),
  }))

vi.mock('@/lib/workflows/orchestration/deploy', () => ({
  getWorkflowDeploymentSummary: mockGetWorkflowDeploymentSummary,
  performFullDeploy: mockPerformFullDeploy,
}))

vi.mock('@/lib/workflows/deployment-status', () => ({
  checkNeedsRedeployment: mockCheckNeedsRedeployment,
}))

import { performChatDeploy } from '@/lib/workflows/orchestration/chat-deploy'

const basePayload = {
  workflowId: 'workflow-1',
  userId: 'user-1',
  identifier: 'my-chat',
  title: 'Support',
}

describe('performChatDeploy password guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGetWorkflowDeploymentSummary.mockResolvedValue({
      activeDeployment: { id: 'deployment-1' },
      latestDeploymentAttempt: { status: 'active' },
      warnings: [],
    })
    mockCheckNeedsRedeployment.mockResolvedValue(false)
  })

  afterAll(() => {
    resetDbChainMock()
  })

  /**
   * The copilot `deploy_as_chat` tool reaches this function without a route
   * contract, so these guards are the only thing standing between an agent and
   * a deployment nobody can log into.
   */
  it('rejects a whitespace-only password before touching the deployment', async () => {
    await expect(
      performChatDeploy({ ...basePayload, authType: 'password', password: '   ' })
    ).resolves.toEqual({
      success: false,
      error: 'Password cannot contain only whitespace',
    })

    expect(mockGetWorkflowDeploymentSummary).not.toHaveBeenCalled()
  })

  it('rejects a password longer than the chat login accepts', async () => {
    await expect(
      performChatDeploy({ ...basePayload, authType: 'password', password: 'a'.repeat(1025) })
    ).resolves.toEqual({
      success: false,
      error: 'Password is too long',
    })

    expect(mockGetWorkflowDeploymentSummary).not.toHaveBeenCalled()
  })

  it('rejects a whitespace-only password regardless of auth type', async () => {
    await expect(
      performChatDeploy({ ...basePayload, authType: 'public', password: '   ' })
    ).resolves.toEqual({
      success: false,
      error: 'Password cannot contain only whitespace',
    })
  })

  it('rejects password protection with no password and no stored one', async () => {
    queueTableRows(schemaMock.chat, [])

    await expect(performChatDeploy({ ...basePayload, authType: 'password' })).resolves.toEqual({
      success: false,
      error: 'Password is required when using password protection',
    })
  })

  it('does not create a chat from a historical active deployment attempt', async () => {
    mockGetWorkflowDeploymentSummary.mockResolvedValue({
      activeDeployment: null,
      latestDeploymentAttempt: { status: 'active', isCurrent: false },
      warnings: [],
    })
    mockPerformFullDeploy.mockResolvedValue({
      success: true,
      activeDeployment: null,
      latestDeploymentAttempt: { status: 'active', isCurrent: false },
    })

    const result = await performChatDeploy(basePayload)

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('historical'),
    })
  })
})
