/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const operationMocks = vi.hoisted(() => ({
  executeOnePasswordCreateItem: vi.fn(),
  executeOnePasswordDeleteItem: vi.fn(),
  executeOnePasswordGetItem: vi.fn(),
  executeOnePasswordGetItemFile: vi.fn(),
  executeOnePasswordGetVault: vi.fn(),
  executeOnePasswordListItems: vi.fn(),
  executeOnePasswordListVaults: vi.fn(),
  executeOnePasswordReplaceItem: vi.fn(),
  executeOnePasswordResolveSecret: vi.fn(),
  executeOnePasswordUpdateItem: vi.fn(),
}))

vi.mock('@/lib/internal/onepassword/operations', () => operationMocks)

import { OnePasswordOperationError } from '@/lib/internal/onepassword/errors'
import { executeOnePasswordTool } from '@/lib/internal/onepassword/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const CREDENTIALS = {
  connectionMode: 'service_account',
  serviceAccountToken: 'not-a-real-service-account-token',
}

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'onepassword_list_vaults',
    input: CREDENTIALS,
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

const TOOL_CASES = [
  ['onepassword_list_vaults', CREDENTIALS, operationMocks.executeOnePasswordListVaults],
  [
    'onepassword_get_vault',
    { ...CREDENTIALS, vaultId: 'vault-1' },
    operationMocks.executeOnePasswordGetVault,
  ],
  [
    'onepassword_list_items',
    { ...CREDENTIALS, vaultId: 'vault-1' },
    operationMocks.executeOnePasswordListItems,
  ],
  [
    'onepassword_get_item',
    { ...CREDENTIALS, vaultId: 'vault-1', itemId: 'item-1' },
    operationMocks.executeOnePasswordGetItem,
  ],
  [
    'onepassword_create_item',
    { ...CREDENTIALS, vaultId: 'vault-1', category: 'LOGIN' },
    operationMocks.executeOnePasswordCreateItem,
  ],
  [
    'onepassword_update_item',
    {
      ...CREDENTIALS,
      vaultId: 'vault-1',
      itemId: 'item-1',
      operations: '[{"op":"replace","path":"/title","value":"Updated"}]',
    },
    operationMocks.executeOnePasswordUpdateItem,
  ],
  [
    'onepassword_replace_item',
    {
      ...CREDENTIALS,
      vaultId: 'vault-1',
      itemId: 'item-1',
      item: '{"title":"Replacement"}',
    },
    operationMocks.executeOnePasswordReplaceItem,
  ],
  [
    'onepassword_delete_item',
    { ...CREDENTIALS, vaultId: 'vault-1', itemId: 'item-1' },
    operationMocks.executeOnePasswordDeleteItem,
  ],
  [
    'onepassword_resolve_secret',
    { ...CREDENTIALS, secretReference: 'op://vault/item/password' },
    operationMocks.executeOnePasswordResolveSecret,
  ],
  [
    'onepassword_get_item_file',
    { ...CREDENTIALS, vaultId: 'vault-1', itemId: 'item-1', fileId: 'file-1' },
    operationMocks.executeOnePasswordGetItemFile,
  ],
] as const

describe('executeOnePasswordTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const operation of Object.values(operationMocks)) {
      operation.mockResolvedValue({ handled: true })
    }
  })

  it.each(TOOL_CASES)('validates and dispatches %s', async (toolId, input, operation) => {
    const controller = new AbortController()
    const response = await executeOnePasswordTool(
      createRequest({ toolId, input, signal: controller.signal })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ handled: true })
    expect(operation).toHaveBeenCalledWith(expect.objectContaining(input), {
      signal: controller.signal,
    })
  })

  it('preserves canonical validation envelopes for semantic input', async () => {
    const invalidInput = await executeOnePasswordTool(createRequest({ input: '{' }))
    expect(invalidInput.status).toBe(400)
    await expect(invalidInput.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })

    const invalidBody = await executeOnePasswordTool(
      createRequest({
        toolId: 'onepassword_get_item',
        input: { ...CREDENTIALS, vaultId: '', itemId: '' },
      })
    )
    expect(invalidBody.status).toBe(400)
    await expect(invalidBody.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
    expect(operationMocks.executeOnePasswordGetItem).not.toHaveBeenCalled()
  })

  it('preserves provider statuses and operation-specific generic failures', async () => {
    operationMocks.executeOnePasswordListVaults.mockRejectedValueOnce(
      new OnePasswordOperationError(429, { error: 'rate limited' })
    )
    const provider = await executeOnePasswordTool(createRequest())
    expect(provider.status).toBe(429)
    await expect(provider.json()).resolves.toEqual({ error: 'rate limited' })

    operationMocks.executeOnePasswordListVaults.mockRejectedValueOnce(
      new Error('network unavailable')
    )
    const generic = await executeOnePasswordTool(createRequest())
    expect(generic.status).toBe(500)
    await expect(generic.json()).resolves.toEqual({
      error: 'Failed to list vaults: network unavailable',
    })
  })

  it('propagates cancellation before provider work', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeOnePasswordTool(createRequest({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(operationMocks.executeOnePasswordListVaults).not.toHaveBeenCalled()
  })

  it('returns a deterministic error for unsupported IDs', async () => {
    const response = await executeOnePasswordTool(createRequest({ toolId: 'onepassword_unknown' }))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Unsupported 1Password tool: onepassword_unknown',
    })
  })
})
