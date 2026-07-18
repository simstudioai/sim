import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLoadDraft = vi.fn()
const mockLoadDeployed = vi.fn()
const mockResolveApiStart = vi.fn()
const mockHasHitl = vi.fn()
const mockFlatten = vi.fn()

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowFromNormalizedTables: (...args: unknown[]) => mockLoadDraft(...args),
  loadWorkflowDeploymentVersionState: (...args: unknown[]) => mockLoadDeployed(...args),
}))

vi.mock('@/lib/interfaces/spec/api-start-input', () => ({
  resolveApiStartInput: (...args: unknown[]) => mockResolveApiStart(...args),
}))

vi.mock('@/lib/interfaces/spec/validate', () => ({
  workflowHasHitlBlocks: (...args: unknown[]) => mockHasHitl(...args),
}))

vi.mock('@/lib/workflows/blocks/flatten-outputs', () => ({
  flattenWorkflowOutputs: (...args: unknown[]) => mockFlatten(...args),
}))

vi.mock('@/blocks', () => ({
  getBlock: (type: string) => {
    if (type !== 'tiktok') return null
    return {
      subBlocks: [
        {
          id: 'credential',
          type: 'oauth-input',
          serviceId: 'tiktok',
          required: true,
          requiredScopes: ['user.info.basic'],
        },
      ],
    }
  },
}))

import { buildBoundActionEntryFromDraft } from '@/lib/apps/bind-actions'

describe('buildBoundActionEntryFromDraft credential boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasHitl.mockReturnValue(false)
    mockFlatten.mockReturnValue([])
  })

  it('rejects credential-like API start fields', async () => {
    mockLoadDraft.mockResolvedValue({
      blocks: {
        start: { id: 'start', type: 'api_trigger', subBlocks: {} },
        tiktok: {
          id: 'tiktok',
          type: 'tiktok',
          subBlocks: { credential: { id: 'credential', type: 'oauth-input', value: 'cred-1' } },
        },
      },
      edges: [],
    })
    mockResolveApiStart.mockReturnValue({
      ok: true,
      data: { fields: [{ name: 'oauthCredential', type: 'string', required: true }] },
    })

    const result = await buildBoundActionEntryFromDraft({
      workspaceId: 'ws-1',
      actionId: 'main',
      workflowId: 'wf-1',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('CREDENTIAL_FIELD_EXPOSED')
  })

  it('rejects unbound required oauth-input blocks', async () => {
    mockLoadDraft.mockResolvedValue({
      blocks: {
        start: { id: 'start', type: 'api_trigger', subBlocks: {} },
        tiktok: {
          id: 'tiktok',
          type: 'tiktok',
          subBlocks: { credential: { id: 'credential', type: 'oauth-input', value: '' } },
        },
      },
      edges: [],
    })
    mockResolveApiStart.mockReturnValue({
      ok: true,
      data: { fields: [{ name: 'fields', type: 'string', required: false }] },
    })

    const result = await buildBoundActionEntryFromDraft({
      workspaceId: 'ws-1',
      actionId: 'main',
      workflowId: 'wf-1',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('OAUTH_UNBOUND')
  })

  it('rejects App inputs wired into provider field configuration', async () => {
    mockLoadDraft.mockResolvedValue({
      blocks: {
        start: { id: 'start', type: 'api_trigger', subBlocks: {} },
        tiktok: {
          id: 'tiktok',
          type: 'tiktok',
          subBlocks: {
            credential: { id: 'credential', type: 'oauth-input', value: 'cred-1' },
            fields: { id: 'fields', type: 'short-input', value: '<start.fields>' },
          },
        },
      },
      edges: [],
    })
    mockResolveApiStart.mockReturnValue({
      ok: true,
      data: {
        blockId: 'start',
        fields: [{ name: 'fields', type: 'string', required: false }],
      },
    })

    const result = await buildBoundActionEntryFromDraft({
      workspaceId: 'ws-1',
      actionId: 'main',
      workflowId: 'wf-1',
    })

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        code: 'PROVIDER_CONFIG_INPUT_EXPOSED',
      })
    )
  })
})
