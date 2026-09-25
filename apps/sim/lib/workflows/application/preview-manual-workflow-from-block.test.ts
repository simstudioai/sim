/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  permission: vi.fn(),
  loadDraft: vi.fn(),
  loadSource: vi.fn(),
  serialize: vi.fn(),
  blockScope: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) =>
    actual === 'admin' || actual === required || (actual === 'write' && required === 'read'),
  resolveEffectiveWorkspacePermission: mocks.permission,
}))
vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkflowApplicationContext: mocks.context,
}))
vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowFromNormalizedTables: mocks.loadDraft,
}))
vi.mock('@/lib/workflows/executor/execution-state', () => ({
  getExecutionStateForWorkflow: mocks.loadSource,
}))
vi.mock('@/lib/workflows/application/workflow-block-scope', () => ({
  withWorkflowBlockScope: mocks.blockScope,
}))
vi.mock('@/serializer', () => ({
  Serializer: class {
    serializeWorkflow = mocks.serialize
  },
}))

import type { OAuthAccessTokenPrincipal } from '@sim/auth/principal'
import { v2WorkflowRunFromBlockPreviewSchema } from '@/lib/api/contracts/v2/workflows'
import { previewManualWorkflowFromBlock } from '@/lib/workflows/application/preview-manual-workflow-from-block'

const personal = { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'key-1' }
const oauth: OAuthAccessTokenPrincipal = {
  kind: 'oauth_access_token',
  userId: 'user-1',
  clientId: 'client-1',
  tokenId: 'token-1',
  scopes: ['api:read'],
  expiresAt: new Date('2099-01-01'),
}
const input = { workflowId: 'workflow-1', blockId: 'target', sourceRunId: 'source-run' }
const context = {
  workflowId: 'workflow-1',
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
}

describe('authorized read-only manual workflow preview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.context.mockResolvedValue(context)
    mocks.permission.mockResolvedValue('write')
    mocks.blockScope.mockImplementation(async (_context, run) => run())
    mocks.loadDraft.mockResolvedValue({
      blocks: { target: { id: 'target', subBlocks: {} } },
      edges: [],
      loops: {},
      parallels: {},
    })
    mocks.loadSource.mockResolvedValue({
      blockStates: {
        target: { output: { secret: 'never return this' }, executed: true, executionTime: 1 },
      },
      executedBlocks: ['target'],
      blockLogs: [],
      decisions: { router: {}, condition: {} },
      completedLoops: [],
      activeExecutionPath: [],
    })
    mocks.serialize.mockReturnValue({
      version: '1',
      loops: {},
      connections: [],
      blocks: [
        {
          id: 'target',
          position: { x: 0, y: 0 },
          config: { tool: '', params: {} },
          inputs: {},
          outputs: {},
          metadata: { id: 'function', name: 'Target' },
          enabled: true,
        },
      ],
    })
  })

  it.each([personal, oauth])(
    'reads under $kind without writes or disclosing cached output values',
    async (principal) => {
      const result = await previewManualWorkflowFromBlock.execute({ principal, input })
      expect(mocks.loadDraft).toHaveBeenCalledWith('workflow-1', undefined, {
        persistMigrations: false,
      })
      expect(mocks.loadSource).toHaveBeenCalledWith('source-run', 'workflow-1')
      expect(mocks.blockScope).toHaveBeenCalledWith(context, expect.any(Function))
      expect(result.validation).toEqual({ valid: true })
      expect(v2WorkflowRunFromBlockPreviewSchema.parse(result)).toEqual(result)
      expect(JSON.stringify(result)).not.toContain('never return this')
      expect(result).not.toHaveProperty('runId')
      expect(result.notes.join(' ')).toContain('can repeat actions')
    }
  )

  it('requires current write permission before loading draft or execution state', async () => {
    mocks.permission.mockResolvedValue('read')
    await expect(
      previewManualWorkflowFromBlock.execute({ principal: personal, input })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.loadDraft).not.toHaveBeenCalled()
    expect(mocks.loadSource).not.toHaveBeenCalled()
    expect(mocks.blockScope).not.toHaveBeenCalled()
  })

  it('rejects workspace keys before canonical loading', async () => {
    await expect(
      previewManualWorkflowFromBlock.execute({
        principal: {
          kind: 'workspace_api_key',
          workspaceId: 'workspace-1',
          keyId: 'workspace-key',
        },
        input,
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.context).not.toHaveBeenCalled()
  })

  it('rejects insufficient OAuth scopes before canonical loading', async () => {
    await expect(
      previewManualWorkflowFromBlock.execute({ principal: { ...oauth, scopes: [] }, input })
    ).rejects.toThrow()
    expect(mocks.context).not.toHaveBeenCalled()
  })

  it('supports valid Copilot delegation but refuses a different workspace before state loading', async () => {
    const principal = {
      kind: 'delegated' as const,
      serviceId: 'copilot' as const,
      subjectUserId: 'actor',
      workspaceId: 'workspace-1',
      audience: 'sim:workflows',
      delegationId: 'call-1',
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    }
    await expect(
      previewManualWorkflowFromBlock.execute({ principal, input })
    ).resolves.toMatchObject({ validation: { valid: true } })
    mocks.loadDraft.mockClear()
    await expect(
      previewManualWorkflowFromBlock.execute({
        principal: { ...principal, workspaceId: 'elsewhere' },
        input,
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.loadDraft).not.toHaveBeenCalled()
  })

  it('does not load source state for a nonexistent draft block', async () => {
    await expect(
      previewManualWorkflowFromBlock.execute({
        principal: personal,
        input: { ...input, blockId: 'missing' },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.loadSource).not.toHaveBeenCalled()
  })

  it('returns not found for unavailable source state scoped to the canonical workflow', async () => {
    mocks.loadSource.mockResolvedValue(null)
    await expect(
      previewManualWorkflowFromBlock.execute({ principal: personal, input })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.serialize).not.toHaveBeenCalled()
  })

  it('classifies invalid saved graph errors without masking storage failures', async () => {
    mocks.serialize.mockImplementationOnce(() => {
      throw new Error('Target is missing required fields: code')
    })
    await expect(
      previewManualWorkflowFromBlock.execute({ principal: personal, input })
    ).rejects.toMatchObject({
      code: 'validation',
      message: 'Target is missing required fields: code',
    })
    const storageError = new Error('storage unavailable')
    mocks.loadSource.mockRejectedValue(storageError)
    await expect(
      previewManualWorkflowFromBlock.execute({ principal: personal, input })
    ).rejects.toBe(storageError)
  })
})
