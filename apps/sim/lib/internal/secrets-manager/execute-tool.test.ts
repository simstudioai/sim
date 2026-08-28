/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockOperations = vi.hoisted(() => ({
  executeSecretsManagerGetSecret: vi.fn(),
  executeSecretsManagerListSecrets: vi.fn(),
  executeSecretsManagerCreateSecret: vi.fn(),
  executeSecretsManagerUpdateSecret: vi.fn(),
  executeSecretsManagerDeleteSecret: vi.fn(),
  executeSecretsManagerDescribeSecret: vi.fn(),
  executeSecretsManagerTagResource: vi.fn(),
  executeSecretsManagerUntagResource: vi.fn(),
  executeSecretsManagerRestoreSecret: vi.fn(),
  executeSecretsManagerRotateSecret: vi.fn(),
}))

vi.mock('@/lib/internal/secrets-manager/operations', () => mockOperations)

import { executeSecretsManagerTool } from '@/lib/internal/secrets-manager/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const CONNECTION = {
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
}

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'secrets_manager_list_secrets',
    input: CONNECTION,
    headers: new Headers({ 'content-type': 'application/json' }),
    context: {
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      metadata: {},
    },
    requestId: 'request-1',
    ...overrides,
  }
}

const TOOL_CASES = [
  {
    toolId: 'secrets_manager_get_secret',
    input: { ...CONNECTION, secretId: 'secret-1' },
    operation: mockOperations.executeSecretsManagerGetSecret,
  },
  {
    toolId: 'secrets_manager_list_secrets',
    input: CONNECTION,
    operation: mockOperations.executeSecretsManagerListSecrets,
  },
  {
    toolId: 'secrets_manager_create_secret',
    input: { ...CONNECTION, name: 'secret-1', secretValue: 'value' },
    operation: mockOperations.executeSecretsManagerCreateSecret,
  },
  {
    toolId: 'secrets_manager_update_secret',
    input: { ...CONNECTION, secretId: 'secret-1', secretValue: 'value' },
    operation: mockOperations.executeSecretsManagerUpdateSecret,
  },
  {
    toolId: 'secrets_manager_delete_secret',
    input: { ...CONNECTION, secretId: 'secret-1' },
    operation: mockOperations.executeSecretsManagerDeleteSecret,
  },
  {
    toolId: 'secrets_manager_describe_secret',
    input: { ...CONNECTION, secretId: 'secret-1' },
    operation: mockOperations.executeSecretsManagerDescribeSecret,
  },
  {
    toolId: 'secrets_manager_tag_resource',
    input: { ...CONNECTION, secretId: 'secret-1', tags: [{ key: 'team', value: 'platform' }] },
    operation: mockOperations.executeSecretsManagerTagResource,
  },
  {
    toolId: 'secrets_manager_untag_resource',
    input: { ...CONNECTION, secretId: 'secret-1', tagKeys: ['team'] },
    operation: mockOperations.executeSecretsManagerUntagResource,
  },
  {
    toolId: 'secrets_manager_restore_secret',
    input: { ...CONNECTION, secretId: 'secret-1' },
    operation: mockOperations.executeSecretsManagerRestoreSecret,
  },
  {
    toolId: 'secrets_manager_rotate_secret',
    input: { ...CONNECTION, secretId: 'secret-1', automaticallyAfterDays: 30 },
    operation: mockOperations.executeSecretsManagerRotateSecret,
  },
] as const

describe('executeSecretsManagerTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(TOOL_CASES)('validates and dispatches $toolId', async ({ toolId, input, operation }) => {
    const controller = new AbortController()
    operation.mockResolvedValue({ toolId })

    const response = await executeSecretsManagerTool(
      createRequest({ toolId, input, signal: controller.signal })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ toolId })
    expect(operation).toHaveBeenCalledWith(input, controller.signal)
  })

  it('returns the route-compatible validation envelope before provider work', async () => {
    const response = await executeSecretsManagerTool(createRequest({ input: { region: '' } }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
    expect(mockOperations.executeSecretsManagerListSecrets).not.toHaveBeenCalled()
  })

  it('preserves the provider error envelope', async () => {
    mockOperations.executeSecretsManagerListSecrets.mockRejectedValue(
      new Error('AWS rejected credentials')
    )

    const response = await executeSecretsManagerTool(createRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to list secrets: AWS rejected credentials',
    })
  })

  it('propagates cancellation without starting provider work', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeSecretsManagerTool(createRequest({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockOperations.executeSecretsManagerListSecrets).not.toHaveBeenCalled()
  })
})
