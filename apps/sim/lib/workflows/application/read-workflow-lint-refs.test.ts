/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  permission: vi.fn(),
  snapshot: vi.fn(),
  selector: vi.fn(),
  document: vi.fn(),
  secrets: vi.fn(),
  block: vi.fn((type: string) => ({
    type,
    name: type,
    outputs: {},
    subBlocks:
      type === 'workflow_input'
        ? [
            {
              id: 'workflowId',
              type: 'workflow-selector',
              canonicalParamId: 'workflowId',
              mode: 'basic',
            },
            {
              id: 'manualWorkflowId',
              type: 'short-input',
              canonicalParamId: 'workflowId',
              mode: 'advanced',
            },
          ]
        : type === 'knowledge'
          ? [
              {
                id: 'knowledgeBaseSelector',
                type: 'knowledge-base-selector',
                canonicalParamId: 'knowledgeBaseId',
                mode: 'basic',
              },
              {
                id: 'manualKnowledgeBaseId',
                type: 'short-input',
                canonicalParamId: 'knowledgeBaseId',
                mode: 'advanced',
              },
              {
                id: 'documentSelector',
                type: 'document-selector',
                canonicalParamId: 'documentId',
                mode: 'basic',
                condition: { field: 'operation', value: 'get_document' },
              },
              {
                id: 'documentId',
                type: 'short-input',
                canonicalParamId: 'documentId',
                mode: 'advanced',
                condition: { field: 'operation', value: 'get_document' },
              },
            ]
          : [],
  })),
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null) => actual !== null,
  resolveEffectiveWorkspacePermission: mocks.permission,
}))
vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkflowApplicationContext: mocks.context,
}))
vi.mock('@/lib/workflows/queries', () => ({ loadWorkflowReadSnapshot: mocks.snapshot }))
vi.mock('@/lib/workflows/editing/selector-validator', () => ({
  validateSelectorIds: mocks.selector,
}))
vi.mock('@/lib/workflows/custom-tools/operations', () => ({ getCustomToolById: vi.fn() }))
vi.mock('@/lib/workflows/skills/operations', () => ({ getSkillById: vi.fn() }))
vi.mock('@/lib/table/service', () => ({ getTableById: vi.fn() }))
vi.mock('@/lib/secrets/application/use-cases', () => ({
  listSecretsUseCase: { execute: mocks.secrets },
}))
vi.mock('@/blocks/utils', () => ({ getModelOptions: vi.fn(() => []) }))
vi.mock('@/tools/utils', () => ({ getTool: vi.fn() }))
vi.mock('@/blocks/registry', () => ({ getBlock: mocks.block }))
vi.mock('@/blocks', () => ({ getBlock: mocks.block }))
vi.mock('@/lib/knowledge/application/documents', () => ({
  readKnowledgeDocument: { execute: mocks.document },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { readWorkflowLint } from '@/lib/workflows/application/read-workflow-lint'

const principal = { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'key-1' }
const scope = {
  workspaceId: 'parent-workspace',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner',
}

function graph(childId: string) {
  return {
    blocks: {
      child: {
        id: 'child',
        type: 'workflow_input',
        name: 'Child',
        enabled: true,
        position: { x: 0, y: 0 },
        outputs: {},
        subBlocks: {
          workflowId: { id: 'workflowId', type: 'workflow-selector', value: childId },
        },
      },
    },
    edges: [],
    loops: {},
    parallels: {},
  }
}

function documentGraph(knowledgeBaseId = 'selected-kb', documentId = 'selected-document') {
  return {
    ...graph(''),
    blocks: {
      doc: {
        ...graph('').blocks.child,
        id: 'doc',
        type: 'knowledge',
        name: 'Read document',
        subBlocks: {
          operation: { value: 'get_document' },
          knowledgeBaseSelector: { value: knowledgeBaseId },
          documentSelector: { value: documentId },
        },
      },
    },
  }
}

describe('standalone workflow-reference diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.context.mockImplementation(
      async (input: { workflowId: string; assertedWorkspaceId?: string }) => {
        const workspaceId = input.workflowId === 'foreign' ? 'other-workspace' : scope.workspaceId
        if (input.assertedWorkspaceId && input.assertedWorkspaceId !== workspaceId) {
          throw new OrchestrationError('not_found', 'Workflow not found')
        }
        return {
          ...scope,
          workspaceId,
          workflowId: input.workflowId,
          workflow: { id: input.workflowId, workspaceId },
        }
      }
    )
    mocks.permission.mockResolvedValue('read')
    mocks.snapshot.mockResolvedValue({
      workflowRecord: { id: 'parent' },
      normalizedData: graph('foreign'),
    })
    mocks.selector.mockResolvedValue({ valid: ['foreign'], invalid: [] })
    mocks.document.mockResolvedValue(undefined)
    mocks.secrets.mockResolvedValue({ secrets: [] })
  })

  it('reports a regular child in another workspace even when its global ID exists', async () => {
    const result = await readWorkflowLint.execute({ principal, input: { workflowId: 'parent' } })
    expect(result.unresolvedReferences).toEqual([
      expect.objectContaining({
        blockId: 'child',
        field: 'workflowId',
        value: 'foreign',
        kind: 'resource',
      }),
    ])
    expect(mocks.context).toHaveBeenCalledWith({
      workflowId: 'foreign',
      assertedWorkspaceId: scope.workspaceId,
    })
    expect(mocks.selector).not.toHaveBeenCalledWith(
      'workflow-selector',
      expect.anything(),
      expect.anything(),
      expect.anything()
    )
  })

  it('accepts an authorized child in the same workspace without loading its graph', async () => {
    mocks.snapshot.mockResolvedValue({
      workflowRecord: { id: 'parent' },
      normalizedData: graph('local'),
    })
    const result = await readWorkflowLint.execute({ principal, input: { workflowId: 'parent' } })
    expect(result.unresolvedReferences).toEqual([])
    expect(mocks.context).toHaveBeenCalledWith({
      workflowId: 'local',
      assertedWorkspaceId: scope.workspaceId,
    })
    expect(mocks.snapshot).toHaveBeenCalledTimes(1)
    expect(mocks.permission).toHaveBeenCalledTimes(2)
  })

  it.each(['not_found', 'forbidden'] as const)(
    'reports an unresolved reference for a %s child without exposing private metadata',
    async (code) => {
      mocks.context
        .mockResolvedValueOnce({ ...scope, workflowId: 'parent', workflow: { id: 'parent' } })
        .mockRejectedValueOnce(new OrchestrationError(code, 'Private child title and workspace'))
      const result = await readWorkflowLint.execute({ principal, input: { workflowId: 'parent' } })
      expect(result.unresolvedReferences).toHaveLength(1)
      expect(JSON.stringify(result)).not.toContain('Private child')
    }
  )

  it('propagates a child lookup outage rather than declaring the reference invalid or valid', async () => {
    mocks.context
      .mockResolvedValueOnce({ ...scope, workflowId: 'parent', workflow: { id: 'parent' } })
      .mockRejectedValueOnce(new Error('database unavailable'))
    await expect(
      readWorkflowLint.execute({ principal, input: { workflowId: 'parent' } })
    ).rejects.toThrow('Workflow reference checks could not complete')
  })

  it('requires current child permission even after the parent read is authorized', async () => {
    mocks.snapshot.mockResolvedValue({
      workflowRecord: { id: 'parent' },
      normalizedData: graph('local'),
    })
    mocks.permission.mockResolvedValueOnce('read').mockResolvedValueOnce(null)
    const result = await readWorkflowLint.execute({ principal, input: { workflowId: 'parent' } })
    expect(result.unresolvedReferences).toEqual([expect.objectContaining({ value: 'local' })])
  })

  it('does not read dormant basic-mode IDs while the block is in advanced mode', async () => {
    const state = graph('foreign')
    const child = {
      ...state.blocks.child,
      data: { canonicalModes: { workflowId: 'advanced' } },
      subBlocks: {
        ...state.blocks.child.subBlocks,
        manualWorkflowId: { id: 'manualWorkflowId', type: 'short-input', value: '<start.childId>' },
      },
    }
    mocks.snapshot.mockResolvedValue({
      workflowRecord: { id: 'parent' },
      normalizedData: { ...state, blocks: { child } },
    })
    const result = await readWorkflowLint.execute({ principal, input: { workflowId: 'parent' } })
    expect(
      result.unresolvedReferences.filter((reference) => reference.kind === 'resource')
    ).toEqual([])
    expect(mocks.context).toHaveBeenCalledTimes(1)
  })

  it('does not apply regular-workflow selectors to a custom block publisher binding', async () => {
    const state = graph('foreign')
    mocks.snapshot.mockResolvedValue({
      workflowRecord: { id: 'parent' },
      normalizedData: {
        ...state,
        blocks: { child: { ...state.blocks.child, type: 'custom_example' } },
      },
    })
    const result = await readWorkflowLint.execute({ principal, input: { workflowId: 'parent' } })
    expect(result.unresolvedReferences).toEqual([])
    expect(mocks.context).toHaveBeenCalledTimes(1)
  })

  it('checks a literal child ID supplied through the active advanced input', async () => {
    const state = graph('local')
    const child = {
      ...state.blocks.child,
      data: { canonicalModes: { workflowId: 'advanced' } },
      subBlocks: {
        ...state.blocks.child.subBlocks,
        manualWorkflowId: { value: 'foreign' },
      },
    }
    mocks.snapshot.mockResolvedValue({
      workflowRecord: { id: 'parent' },
      normalizedData: { ...state, blocks: { child } },
    })
    const result = await readWorkflowLint.execute({ principal, input: { workflowId: 'parent' } })
    expect(result.unresolvedReferences).toEqual([
      expect.objectContaining({ field: 'manualWorkflowId', value: 'foreign' }),
    ])
    expect(mocks.context).toHaveBeenCalledWith({
      workflowId: 'foreign',
      assertedWorkspaceId: scope.workspaceId,
    })
    expect(mocks.context).not.toHaveBeenCalledWith(expect.objectContaining({ workflowId: 'local' }))
  })

  it.each(['not_found', 'forbidden'] as const)(
    'checks a %s document against its selected knowledge base and canonical workspace',
    async (code) => {
      mocks.snapshot.mockResolvedValue({
        workflowRecord: { id: 'parent' },
        normalizedData: documentGraph('selected-kb', 'foreign-document'),
      })
      mocks.document.mockRejectedValueOnce(
        new OrchestrationError(code, 'Private document does not belong to this base')
      )
      const result = await readWorkflowLint.execute({ principal, input: { workflowId: 'parent' } })
      expect(result.unresolvedReferences).toEqual([
        expect.objectContaining({
          blockId: 'doc',
          field: 'documentSelector',
          value: 'foreign-document',
        }),
      ])
      expect(mocks.document).toHaveBeenCalledWith({
        principal,
        input: {
          knowledgeBaseId: 'selected-kb',
          documentId: 'foreign-document',
          assertedWorkspaceId: scope.workspaceId,
        },
        request: undefined,
      })
      expect(JSON.stringify(result)).not.toContain('Private document')
    }
  )

  it.each([principal, { kind: 'session' as const, userId: 'user-2' }])(
    'uses the authenticated $kind for a readable document',
    async (actor) => {
      mocks.snapshot.mockResolvedValue({
        workflowRecord: { id: 'parent' },
        normalizedData: documentGraph(),
      })
      mocks.document.mockResolvedValue({
        document: { id: 'selected-document', content: 'Private document content' },
      })
      const result = await readWorkflowLint.execute({
        principal: actor,
        input: { workflowId: 'parent' },
      })
      expect(result.unresolvedReferences).toEqual([])
      expect(mocks.document).toHaveBeenCalledWith({
        principal: actor,
        input: {
          knowledgeBaseId: 'selected-kb',
          documentId: 'selected-document',
          assertedWorkspaceId: scope.workspaceId,
        },
        request: undefined,
      })
      expect(JSON.stringify(result)).not.toContain('Private document content')
    }
  )

  it('uses active advanced knowledge-base and document IDs instead of stale basic values', async () => {
    const state = documentGraph('stale-kb', 'stale-document')
    const doc = {
      ...state.blocks.doc,
      data: { canonicalModes: { knowledgeBaseId: 'advanced', documentId: 'advanced' } },
      subBlocks: {
        ...state.blocks.doc.subBlocks,
        manualKnowledgeBaseId: { value: 'active-kb' },
        documentId: { value: 'active-document' },
      },
    }
    mocks.snapshot.mockResolvedValue({
      workflowRecord: { id: 'parent' },
      normalizedData: { ...state, blocks: { doc } },
    })
    const result = await readWorkflowLint.execute({ principal, input: { workflowId: 'parent' } })
    expect(result.unresolvedReferences).toEqual([])
    expect(mocks.document).toHaveBeenCalledExactlyOnceWith({
      principal,
      input: {
        knowledgeBaseId: 'active-kb',
        documentId: 'active-document',
        assertedWorkspaceId: scope.workspaceId,
      },
      request: undefined,
    })
  })

  it.each(['', '<start.baseId>', 'prefix-<start.baseId>', '{{BASE_ID}}'])(
    'reports an unchecked document when the active knowledge base is %j',
    async (value) => {
      const state = documentGraph('stale-kb')
      const doc = {
        ...state.blocks.doc,
        data: { canonicalModes: { knowledgeBaseId: 'advanced' } },
        subBlocks: {
          ...state.blocks.doc.subBlocks,
          manualKnowledgeBaseId: { value },
        },
      }
      mocks.snapshot.mockResolvedValue({
        workflowRecord: { id: 'parent' },
        normalizedData: { ...state, blocks: { doc } },
      })
      const result = await readWorkflowLint.execute({ principal, input: { workflowId: 'parent' } })
      expect(result.notes).toContain(
        'Document references in block "Read document" were not checked because its active knowledge base ID is empty or requires runtime resolution.'
      )
      expect(mocks.document).not.toHaveBeenCalled()
    }
  )

  it('does not inspect a stale document field when the operation no longer uses it', async () => {
    const state = documentGraph()
    state.blocks.doc.subBlocks.operation.value = 'search'
    mocks.snapshot.mockResolvedValue({ workflowRecord: { id: 'parent' }, normalizedData: state })
    mocks.document.mockRejectedValue(new OrchestrationError('not_found', 'Document not found'))
    const result = await readWorkflowLint.execute({ principal, input: { workflowId: 'parent' } })
    expect(result.unresolvedReferences).toEqual([])
    expect(mocks.document).not.toHaveBeenCalled()
  })

  it('distinguishes runtime document IDs from literal IDs in the same field', async () => {
    mocks.snapshot.mockResolvedValue({
      workflowRecord: { id: 'parent' },
      normalizedData: documentGraph('selected-kb', '<start.documentId>,selected-document'),
    })
    const result = await readWorkflowLint.execute({ principal, input: { workflowId: 'parent' } })
    expect(mocks.document).toHaveBeenCalledTimes(1)
    expect(mocks.document).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ documentId: 'selected-document' }),
      })
    )
    expect(result.notes).toContain(
      'Runtime values in reference field "documentSelector" in block "Read document" were not checked.'
    )
  })

  it('propagates a document read outage without turning it into a finding', async () => {
    mocks.snapshot.mockResolvedValue({
      workflowRecord: { id: 'parent' },
      normalizedData: documentGraph(),
    })
    mocks.document.mockRejectedValue(new Error('database unavailable'))
    await expect(
      readWorkflowLint.execute({ principal, input: { workflowId: 'parent' } })
    ).rejects.toThrow('Workflow reference checks could not complete')
  })

  it('does not begin another document lookup after cancellation', async () => {
    const controller = new AbortController()
    mocks.snapshot.mockResolvedValue({
      workflowRecord: { id: 'parent' },
      normalizedData: documentGraph('selected-kb', 'document-1,document-2'),
    })
    mocks.document.mockImplementationOnce(async () => {
      controller.abort()
      return {}
    })
    await expect(
      readWorkflowLint.execute({
        principal,
        input: { workflowId: 'parent', signal: controller.signal },
      })
    ).rejects.toThrow('Workflow reference checks could not complete')
    expect(mocks.document).toHaveBeenCalledTimes(1)
    expect(mocks.secrets).not.toHaveBeenCalled()
  })
})
