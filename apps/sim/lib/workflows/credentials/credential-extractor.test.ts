/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  collectStrippedWorkspaceBindings,
  EXPORT_PRESERVED_RESOURCE_TYPES,
  sanitizeWorkflowForSharing,
} from '@/lib/workflows/credentials/credential-extractor'
import { WORKFLOW_SEARCH_SUBBLOCK_RESOURCE_TYPES } from '@/lib/workflows/search-replace/resources/registry'
import { getBlock } from '@/blocks/registry'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

vi.mock('@/lib/workflows/search-replace/indexer', () => ({
  getToolInputParamConfigs: ({
    tool,
  }: {
    tool: { type: string; params?: Record<string, unknown> }
  }) =>
    Object.entries(tool.params ?? {}).map(([paramId, value]) => ({
      paramId,
      authoritative: tool.type !== 'custom-tool' && tool.type !== 'mcp',
      value,
      config: {
        id: paramId,
        type: 'short-input',
        password: paramId === 'apiKey' || paramId === 'token',
        canonicalParamId: paramId === 'manualCredential' ? 'oauthCredential' : undefined,
      },
    })),
}))

function stateWithSubBlock(type: string, value: unknown): Partial<WorkflowState> {
  return {
    blocks: {
      b1: {
        id: 'b1',
        type: 'test-block',
        name: 'Test',
        position: { x: 0, y: 0 },
        subBlocks: { field: { id: 'field', type, value } },
        outputs: {},
        enabled: true,
      },
    },
  } as unknown as Partial<WorkflowState>
}

/**
 * The exact option set `json-sanitizer`'s `sanitizeForExport` passes, copied rather than imported
 * so this suite keeps testing `credential-extractor` without pulling in its own consumer.
 *
 * The copy cannot drift unnoticed: `import-export-roundtrip` calls the real `sanitizeForExport`
 * and asserts the same withholding, so dropping an option there turns that suite red. Every
 * export-shaped assertion below must use this constant — one that quietly omitted
 * `redactOpaqueCredentialInputs` would describe a configuration no export surface runs.
 */
const EXPORT_OPTIONS = { preserveEnvVars: true, redactOpaqueCredentialInputs: true } as const

function sanitizedValue(type: string, value: unknown): unknown {
  vi.mocked(getBlock).mockReturnValue({
    name: 'Test',
    description: '',
    subBlocks: [{ id: 'field', title: 'Field', type }],
    outputs: {},
  } as never)
  const sanitized = sanitizeWorkflowForSharing(stateWithSubBlock(type, value), EXPORT_OPTIONS)
  return sanitized.blocks?.b1?.subBlocks?.field?.value
}

describe('export sanitizer resource coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /**
   * The drift guard. Adding a selector to the resource registry without deciding how export
   * should treat it fails here rather than silently shipping a workspace-scoped id to another
   * workspace — which is exactly how raw `tbl_…` table ids used to escape.
   */
  it.each(
    WORKFLOW_SEARCH_SUBBLOCK_RESOURCE_TYPES.filter(
      (type) => !EXPORT_PRESERVED_RESOURCE_TYPES.has(type)
    )
  )('clears %s on export', (type) => {
    expect(sanitizedValue(type, 'res-id-123')).toBeNull()
  })

  it('clears a table-selector id, the omission that leaked ids across workspaces', () => {
    expect(sanitizedValue('table-selector', 'tbl_239e870374c14d4a89923175a7b10648')).toBeNull()
  })

  /**
   * Nothing on the import path remaps workflow references — `import-export.ts` extracts each
   * workflow independently under a fresh id — so a preserved reference names a workflow that does
   * not exist in the target, bundle or not.
   */
  it('clears workflow-selector, since import never remaps the id it names', () => {
    expect(sanitizedValue('workflow-selector', 'wf-123')).toBeNull()
  })

  it('still clears oauth-input, via the credential rule rather than the workspace rule', () => {
    expect(sanitizedValue('oauth-input', 'cred-123')).toBeNull()
  })

  it('leaves an ordinary field untouched', () => {
    expect(sanitizedValue('short-input', 'plain text')).toBe('plain text')
  })

  it('clears tableId by key on a block with no registry config', () => {
    vi.mocked(getBlock).mockReturnValue(undefined as never)
    const sanitized = sanitizeWorkflowForSharing(
      {
        blocks: {
          b1: {
            id: 'b1',
            type: 'unknown-block',
            name: 'Test',
            position: { x: 0, y: 0 },
            subBlocks: { tableId: { id: 'tableId', type: 'short-input', value: 'tbl_abc' } },
            outputs: {},
            enabled: true,
          },
        },
      } as unknown as Partial<WorkflowState>,
      EXPORT_OPTIONS
    )
    expect(sanitized.blocks?.b1?.subBlocks?.tableId?.value).toBeNull()
  })

  it('uses authoritative tool-input codecs to withhold secrets while preserving safe config', () => {
    const value = [
      {
        type: 'gmail',
        toolId: 'gmail_send',
        operation: 'send_gmail',
        params: {
          apiKey: 'sk-plaintext-secret',
          query: 'safe input',
        },
      },
    ]
    vi.mocked(getBlock).mockReturnValue({
      name: 'Test',
      description: '',
      subBlocks: [{ id: 'field', title: 'Field', type: 'tool-input' }],
      outputs: {},
    } as never)

    const sanitized = sanitizeWorkflowForSharing(
      stateWithSubBlock('tool-input', value),
      EXPORT_OPTIONS
    )

    expect(sanitized.blocks?.b1?.subBlocks?.field?.value).toEqual([
      {
        type: 'gmail',
        toolId: 'gmail_send',
        operation: 'send_gmail',
        params: { apiKey: null, query: 'safe input' },
      },
    ])
  })

  it('withholds advanced credential selectors nested inside tool inputs', () => {
    const value = [
      {
        type: 'gmail',
        toolId: 'gmail_send',
        operation: 'send_gmail',
        params: {
          manualCredential: 'credential-id',
          query: 'safe input',
        },
      },
    ]
    vi.mocked(getBlock).mockReturnValue({
      name: 'Test',
      description: '',
      subBlocks: [{ id: 'field', title: 'Field', type: 'tool-input' }],
      outputs: {},
    } as never)

    const sanitized = sanitizeWorkflowForSharing(
      stateWithSubBlock('tool-input', value),
      EXPORT_OPTIONS
    )

    expect(sanitized.blocks?.b1?.subBlocks?.field?.value).toEqual([
      {
        type: 'gmail',
        toolId: 'gmail_send',
        operation: 'send_gmail',
        params: { manualCredential: null, query: 'safe input' },
      },
    ])
  })

  it('withholds opaque table values from public snapshots and exports', () => {
    const value = [
      { Key: 'Authorization', Value: 'Bearer plaintext-secret' },
      { Key: 'API_TOKEN', Value: '{{API_TOKEN}}' },
    ]
    vi.mocked(getBlock).mockReturnValue({
      name: 'Test',
      description: '',
      subBlocks: [{ id: 'field', title: 'Field', type: 'table' }],
      outputs: {},
    } as never)

    const sanitized = sanitizeWorkflowForSharing(stateWithSubBlock('table', value), EXPORT_OPTIONS)

    expect(sanitized.blocks?.b1?.subBlocks?.field?.value).toBeNull()
  })

  it('withholds every unclassified custom-tool parameter', () => {
    vi.mocked(getBlock).mockReturnValue(undefined as never)

    const sanitized = sanitizeWorkflowForSharing(
      stateWithSubBlock('tool-input', [
        {
          type: 'custom-tool',
          params: { token: 'plaintext-secret', query: 'ordinary configuration' },
        },
      ]),
      { redactOpaqueCredentialInputs: true }
    )

    expect(sanitized.blocks?.b1?.subBlocks?.field?.value).toEqual([
      { type: 'custom-tool', params: { token: null, query: null } },
    ])
  })

  it.each([
    ['string', 'plaintext-secret'],
    ['array', ['plaintext-secret']],
  ])('withholds malformed %s tool params', (_shape, params) => {
    vi.mocked(getBlock).mockReturnValue({
      name: 'Test',
      description: '',
      subBlocks: [{ id: 'field', title: 'Field', type: 'tool-input' }],
      outputs: {},
    } as never)

    const sanitized = sanitizeWorkflowForSharing(
      stateWithSubBlock('tool-input', [{ type: 'custom-tool', params }]),
      { redactOpaqueCredentialInputs: true }
    )

    expect(sanitized.blocks?.b1?.subBlocks?.field?.value).toEqual([
      { type: 'custom-tool', params: null },
    ])
  })
})

describe('preserveWorkspaceBindings', () => {
  const SAME_WORKSPACE_OPTIONS = { ...EXPORT_OPTIONS, preserveWorkspaceBindings: true } as const

  function sanitizedWith(type: string, value: unknown, id = 'field'): unknown {
    vi.mocked(getBlock).mockReturnValue({
      name: 'Test',
      description: '',
      subBlocks: [{ id, title: 'Field', type }],
      outputs: {},
    } as never)
    const state = stateWithSubBlock(type, value)
    const block = state.blocks?.b1
    if (block && id !== 'field') {
      block.subBlocks = { [id]: { id, type, value } } as never
    }
    const sanitized = sanitizeWorkflowForSharing(state, SAME_WORKSPACE_OPTIONS)
    return sanitized.blocks?.b1?.subBlocks?.[id]?.value
  }

  it('keeps resource selectors for a same-workspace round trip', () => {
    expect(sanitizedWith('table-selector', 'tbl_239e870374c14d4a89923175a7b10648')).toBe(
      'tbl_239e870374c14d4a89923175a7b10648'
    )
    expect(sanitizedWith('knowledge-base-selector', 'kb_123')).toBe('kb_123')
    expect(sanitizedWith('short-input', 'kb_123', 'knowledgeBaseId')).toBe('kb_123')
  })

  it('still clears credentials, passwords, and credential-keyed fields', () => {
    expect(sanitizedWith('oauth-input', 'cred-123')).toBeNull()
    expect(sanitizedWith('short-input', 'cred-123', 'oauthCredential')).toBeNull()
    vi.mocked(getBlock).mockReturnValue({
      name: 'Test',
      description: '',
      subBlocks: [{ id: 'field', title: 'Field', type: 'short-input', password: true }],
      outputs: {},
    } as never)
    const sanitized = sanitizeWorkflowForSharing(
      stateWithSubBlock('short-input', 'sk-secret'),
      SAME_WORKSPACE_OPTIONS
    )
    expect(sanitized.blocks?.b1?.subBlocks?.field?.value).toBeNull()
  })

  it('keeps a workspace-keyed field on a block with no registry config', () => {
    vi.mocked(getBlock).mockReturnValue(undefined as never)
    const sanitized = sanitizeWorkflowForSharing(
      {
        blocks: {
          b1: {
            id: 'b1',
            type: 'unknown-block',
            name: 'Test',
            position: { x: 0, y: 0 },
            subBlocks: { tableId: { id: 'tableId', type: 'short-input', value: 'tbl_abc' } },
            outputs: {},
            enabled: true,
          },
        },
      } as unknown as Partial<WorkflowState>,
      SAME_WORKSPACE_OPTIONS
    )
    expect(sanitized.blocks?.b1?.subBlocks?.tableId?.value).toBe('tbl_abc')
  })
})

describe('collectStrippedWorkspaceBindings', () => {
  const KNOWLEDGE_BLOCK = {
    name: 'Knowledge',
    description: '',
    subBlocks: [
      { id: 'operation', title: 'Operation', type: 'dropdown' },
      {
        id: 'knowledgeBaseSelector',
        title: 'Knowledge Base',
        type: 'knowledge-base-selector',
        canonicalParamId: 'knowledgeBaseId',
        mode: 'basic',
        required: true,
      },
      {
        id: 'manualKnowledgeBaseId',
        title: 'Knowledge Base ID',
        type: 'short-input',
        canonicalParamId: 'knowledgeBaseId',
        mode: 'advanced',
        required: true,
      },
      {
        id: 'documentSelector',
        title: 'Document',
        type: 'document-selector',
        canonicalParamId: 'documentId',
        mode: 'basic',
        required: true,
        condition: { field: 'operation', value: 'get_document' },
      },
      {
        id: 'tagFilters',
        title: 'Tag Filters',
        type: 'knowledge-tag-filters',
        condition: { field: 'operation', value: 'search' },
      },
      { id: 'credential', title: 'Credential', type: 'oauth-input', required: true },
    ],
    outputs: {},
  }

  function knowledgeState(values: Record<string, unknown>, enabled = true): Partial<WorkflowState> {
    return {
      blocks: {
        kb: {
          id: 'kb',
          type: 'knowledge',
          name: 'Lookup',
          position: { x: 0, y: 0 },
          subBlocks: Object.fromEntries(
            Object.entries(values).map(([id, value]) => [id, { id, type: 'short-input', value }])
          ),
          outputs: {},
          enabled,
        },
      },
    } as unknown as Partial<WorkflowState>
  }

  beforeEach(() => {
    vi.mocked(getBlock).mockReturnValue(KNOWLEDGE_BLOCK as never)
  })

  it('reports a required binding whose canonical pair arrived empty, once, by its canonical id', () => {
    const findings = collectStrippedWorkspaceBindings(
      knowledgeState({
        operation: 'search',
        knowledgeBaseSelector: null,
        manualKnowledgeBaseId: null,
        documentSelector: null,
        tagFilters: null,
        credential: null,
      })
    )

    expect(findings).toEqual([{ blockId: 'kb', blockName: 'Lookup', field: 'knowledgeBaseId' }])
  })

  it('accepts a value on either member and skips hidden, optional, and disabled fields', () => {
    expect(
      collectStrippedWorkspaceBindings(
        knowledgeState({
          operation: 'search',
          knowledgeBaseSelector: null,
          manualKnowledgeBaseId: 'kb_1',
        })
      )
    ).toEqual([])
    expect(
      collectStrippedWorkspaceBindings(
        knowledgeState({
          operation: 'get_document',
          knowledgeBaseSelector: 'kb_1',
          documentSelector: null,
        })
      )
    ).toEqual([{ blockId: 'kb', blockName: 'Lookup', field: 'documentId' }])
    expect(
      collectStrippedWorkspaceBindings(
        knowledgeState({ operation: 'search', knowledgeBaseSelector: null }, false)
      )
    ).toEqual([])
  })

  it('ignores a block the registry does not know', () => {
    vi.mocked(getBlock).mockReturnValue(undefined as never)
    expect(
      collectStrippedWorkspaceBindings(knowledgeState({ knowledgeBaseSelector: null }))
    ).toEqual([])
  })
})
