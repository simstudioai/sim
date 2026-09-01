/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockExecuteStsAssumeRole,
  mockExecuteStsAssumeRoleWithWebIdentity,
  mockExecuteStsAssumeRoleWithSAML,
  mockExecuteStsGetCallerIdentity,
  mockExecuteStsGetSessionToken,
  mockExecuteStsGetAccessKeyInfo,
} = vi.hoisted(() => ({
  mockExecuteStsAssumeRole: vi.fn(),
  mockExecuteStsAssumeRoleWithWebIdentity: vi.fn(),
  mockExecuteStsAssumeRoleWithSAML: vi.fn(),
  mockExecuteStsGetCallerIdentity: vi.fn(),
  mockExecuteStsGetSessionToken: vi.fn(),
  mockExecuteStsGetAccessKeyInfo: vi.fn(),
}))

vi.mock('@/lib/internal/sts/operations', () => ({
  executeStsAssumeRole: mockExecuteStsAssumeRole,
  executeStsAssumeRoleWithWebIdentity: mockExecuteStsAssumeRoleWithWebIdentity,
  executeStsAssumeRoleWithSAML: mockExecuteStsAssumeRoleWithSAML,
  executeStsGetCallerIdentity: mockExecuteStsGetCallerIdentity,
  executeStsGetSessionToken: mockExecuteStsGetSessionToken,
  executeStsGetAccessKeyInfo: mockExecuteStsGetAccessKeyInfo,
}))

import { executeStsTool } from '@/lib/internal/sts/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'sts_get_caller_identity',
    input: {
      region: 'us-east-1',
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-key',
    },
    headers: new Headers({ 'content-type': 'application/json' }),
    context: {
      ...createExecutionContext({ workflowId: 'workflow-1' }),
      workspaceId: 'workspace-1',
      userId: 'user-1',
    },
    requestId: 'request-1',
    ...overrides,
  }
}

describe('executeStsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('validates and executes the matching STS operation', async () => {
    mockExecuteStsGetCallerIdentity.mockResolvedValue({
      account: '123456789012',
      arn: 'arn:aws:iam::123456789012:user/test',
      userId: 'AIDATEST',
    })

    const response = await executeStsTool(createRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      account: '123456789012',
      arn: 'arn:aws:iam::123456789012:user/test',
      userId: 'AIDATEST',
    })
    expect(mockExecuteStsGetCallerIdentity).toHaveBeenCalledWith(
      {
        region: 'us-east-1',
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
      },
      undefined
    )
  })

  it('returns the route-compatible validation envelope before provider work', async () => {
    const response = await executeStsTool(createRequest({ input: { region: 'invalid' } }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
    expect(mockExecuteStsGetCallerIdentity).not.toHaveBeenCalled()
  })

  it('preserves the provider error envelope', async () => {
    mockExecuteStsGetCallerIdentity.mockRejectedValue(new Error('AWS rejected credentials'))

    const response = await executeStsTool(createRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to get caller identity: AWS rejected credentials',
    })
  })

  it('propagates cancellation without converting it into a provider failure', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeStsTool(createRequest({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockExecuteStsGetCallerIdentity).not.toHaveBeenCalled()
  })
})
