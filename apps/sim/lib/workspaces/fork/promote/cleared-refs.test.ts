/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import type { SubBlockConfig } from '@/blocks/types'

// The reference indexer resolves a tool's params via the tool registry; stub it so loading the
// remap module never pulls the full registry (these cases use top-level selectors / dependents).
vi.mock('@/tools/params', () => ({
  getToolIdForOperation: () => undefined,
  getToolParametersConfig: () => null,
  getSubBlocksForToolInput: (
    _toolId: string,
    _type: string,
    _values: unknown,
    _modes: unknown,
    provided?: { subBlocks?: SubBlockConfig[] }
  ) => ({ subBlocks: provided?.subBlocks ?? [] }),
  formatParameterLabel: (label: string) => label,
}))

import { collectForkClearedRefCandidates } from '@/lib/workspaces/fork/promote/cleared-refs'
import {
  buildForkBlockIdResolver,
  deriveForkBlockId,
  EMPTY_FORK_BLOCK_MAP,
} from '@/lib/workspaces/fork/remap/block-identity'
import type { ForkReferenceResolver } from '@/lib/workspaces/fork/remap/remap-references'
import { getBlock } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const blockWith = (subBlocks: SubBlockConfig[]): BlockConfig =>
  ({ name: 'Test', description: '', subBlocks, outputs: {} }) as unknown as BlockConfig

// No persisted block map, so the resolver derives - matching the deriveForkBlockId expectations.
const resolveBlockId = buildForkBlockIdResolver(true, EMPTY_FORK_BLOCK_MAP)

const stateWith = (
  blockType: string,
  blockName: string,
  subBlocks: Record<string, { type?: string; value: unknown }>
): WorkflowState =>
  ({
    blocks: { 'block-1': { id: 'block-1', type: blockType, name: blockName, subBlocks } },
    edges: [],
    loops: {},
    parallels: {},
    variables: {},
  }) as unknown as WorkflowState

interface ParamOverrides {
  items?: Array<{
    sourceWorkflowId: string
    targetWorkflowId: string
    mode: 'create' | 'replace'
    sourceMeta: { name: string }
  }>
  sourceStates?: Map<string, WorkflowState>
  resolver?: ForkReferenceResolver
  workflowIdMap?: Map<string, string>
  sourceLabels?: Map<string, string>
  sourceWorkflowNames?: Map<string, string>
}

const params = (overrides: ParamOverrides) => ({
  items: [],
  sourceStates: new Map<string, WorkflowState>(),
  resolver: (() => null) as ForkReferenceResolver,
  workflowIdMap: new Map<string, string>(),
  resolveBlockId,
  sourceLabels: new Map<string, string>(),
  sourceWorkflowNames: new Map<string, string>(),
  ...overrides,
})

const targetBlockId = deriveForkBlockId('wf-tgt', 'block-1')

describe('collectForkClearedRefCandidates', () => {
  it('emits an unmapped knowledge-base reference (cause reference) with block + field labels', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([{ id: 'kb', title: 'Knowledge Base', type: 'knowledge-base-selector' }])
    )
    const result = collectForkClearedRefCandidates(
      params({
        items: [
          {
            sourceWorkflowId: 'wf-src',
            targetWorkflowId: 'wf-tgt',
            mode: 'replace',
            sourceMeta: { name: 'Search' },
          },
        ],
        sourceStates: new Map([
          [
            'wf-src',
            stateWith('knowledge', 'KB Block', {
              kb: { type: 'knowledge-base-selector', value: 'kb-src' },
            }),
          ],
        ]),
        resolver: () => null,
        sourceLabels: new Map([['knowledge-base:kb-src', 'Docs KB']]),
      })
    )
    expect(result).toEqual([
      {
        targetWorkflowId: 'wf-tgt',
        workflowName: 'Search',
        blockId: targetBlockId,
        blockLabel: 'KB Block',
        fieldLabel: 'Knowledge Base',
        kind: 'knowledge-base',
        sourceId: 'kb-src',
        sourceLabel: 'Docs KB',
        cause: 'reference',
      },
    ])
  })

  it('drops a reference once the resolver maps it (so a mapped resource is not "cleared")', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([{ id: 'kb', title: 'Knowledge Base', type: 'knowledge-base-selector' }])
    )
    const result = collectForkClearedRefCandidates(
      params({
        items: [
          {
            sourceWorkflowId: 'wf-src',
            targetWorkflowId: 'wf-tgt',
            mode: 'replace',
            sourceMeta: { name: 'Search' },
          },
        ],
        sourceStates: new Map([
          [
            'wf-src',
            stateWith('knowledge', 'KB Block', {
              kb: { type: 'knowledge-base-selector', value: 'kb-src' },
            }),
          ],
        ]),
        resolver: (kind, id) => (kind === 'knowledge-base' && id === 'kb-src' ? 'kb-tgt' : null),
      })
    )
    expect(result).toEqual([])
  })

  it('excludes a required credential reference (a blocker resolved by mapping, never cleared)', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([{ id: 'credential', title: 'Account', type: 'oauth-input' }])
    )
    const result = collectForkClearedRefCandidates(
      params({
        items: [
          {
            sourceWorkflowId: 'wf-src',
            targetWorkflowId: 'wf-tgt',
            mode: 'replace',
            sourceMeta: { name: 'Send Email' },
          },
        ],
        sourceStates: new Map([
          [
            'wf-src',
            stateWith('gmail', 'Gmail 1', {
              credential: { type: 'oauth-input', value: 'cred-src' },
            }),
          ],
        ]),
        // An unmapped required credential gates Sync; it must not appear as a "will be cleared" item.
        resolver: () => null,
        sourceLabels: new Map([['credential:cred-src', 'Work Gmail']]),
      })
    )
    expect(result).toEqual([])
  })

  it('never emits an env-var reference (env vars are preserved by name, not cleared)', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([{ id: 'url', title: 'URL', type: 'short-input' }])
    )
    const result = collectForkClearedRefCandidates(
      params({
        items: [
          {
            sourceWorkflowId: 'wf-src',
            targetWorkflowId: 'wf-tgt',
            mode: 'replace',
            sourceMeta: { name: 'API' },
          },
        ],
        sourceStates: new Map([
          [
            'wf-src',
            stateWith('api', 'API', { url: { type: 'short-input', value: '{{API_KEY}}' } }),
          ],
        ]),
        resolver: () => null,
      })
    )
    expect(result).toEqual([])
  })

  it('emits a workflow reference to a workflow not carried into the target (cause workflow)', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([{ id: 'target', title: 'Workflow', type: 'workflow-selector' }])
    )
    const result = collectForkClearedRefCandidates(
      params({
        items: [
          {
            sourceWorkflowId: 'wf-src',
            targetWorkflowId: 'wf-tgt',
            mode: 'replace',
            sourceMeta: { name: 'Caller' },
          },
        ],
        sourceStates: new Map([
          [
            'wf-src',
            stateWith('workflow_caller', 'Run Subflow', {
              target: { type: 'workflow-selector', value: 'wf-other' },
            }),
          ],
        ]),
        workflowIdMap: new Map(),
        sourceWorkflowNames: new Map([['wf-other', 'Other Workflow']]),
      })
    )
    expect(result).toEqual([
      {
        targetWorkflowId: 'wf-tgt',
        workflowName: 'Caller',
        blockId: targetBlockId,
        blockLabel: 'Run Subflow',
        fieldLabel: 'Workflow',
        kind: 'workflow',
        sourceId: 'wf-other',
        sourceLabel: 'Other Workflow',
        cause: 'workflow',
      },
    ])
  })

  it('does not emit a workflow reference when the workflow is carried into the target', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([{ id: 'target', title: 'Workflow', type: 'workflow-selector' }])
    )
    const result = collectForkClearedRefCandidates(
      params({
        items: [
          {
            sourceWorkflowId: 'wf-src',
            targetWorkflowId: 'wf-tgt',
            mode: 'replace',
            sourceMeta: { name: 'Caller' },
          },
        ],
        sourceStates: new Map([
          [
            'wf-src',
            stateWith('workflow_caller', 'Run Subflow', {
              target: { type: 'workflow-selector', value: 'wf-other' },
            }),
          ],
        ]),
        workflowIdMap: new Map([['wf-other', 'wf-other-child']]),
      })
    )
    expect(result).toEqual([])
  })

  it('collapses the workflowId pair to the active member: a dormant basic selector is not a false cleared-ref', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        {
          id: 'workflowId',
          title: 'Workflow',
          type: 'workflow-selector',
          canonicalParamId: 'workflowId',
          mode: 'basic',
        },
        {
          id: 'manualWorkflowId',
          title: 'Workflow ID',
          type: 'short-input',
          canonicalParamId: 'workflowId',
          mode: 'advanced',
        },
      ])
    )
    // Advanced mode active; the dormant basic selector holds a stale, uncopied id.
    const advancedState = {
      blocks: {
        'block-1': {
          id: 'block-1',
          type: 'workflow',
          name: 'Caller',
          data: { canonicalModes: { workflowId: 'advanced' } },
          subBlocks: {
            workflowId: { type: 'workflow-selector', value: 'wf-old' },
            manualWorkflowId: { type: 'short-input', value: 'wf-active' },
          },
        },
      },
      edges: [],
      loops: {},
      parallels: {},
      variables: {},
    } as unknown as WorkflowState
    const item = {
      sourceWorkflowId: 'wf-src',
      targetWorkflowId: 'wf-tgt',
      mode: 'replace' as const,
      sourceMeta: { name: 'Caller' },
    }

    // Active advanced workflow carried into the target: the dormant basic must NOT produce a row.
    const carried = collectForkClearedRefCandidates(
      params({
        items: [item],
        sourceStates: new Map([['wf-src', advancedState]]),
        workflowIdMap: new Map([['wf-active', 'wf-active-child']]),
      })
    )
    expect(carried.filter((ref) => ref.cause === 'workflow')).toEqual([])

    // The ACTIVE member still produces a row when it is not carried (active path unbroken).
    const cleared = collectForkClearedRefCandidates(
      params({
        items: [item],
        sourceStates: new Map([['wf-src', advancedState]]),
        sourceWorkflowNames: new Map([['wf-active', 'Active Workflow']]),
      })
    )
    const workflowRows = cleared.filter((ref) => ref.cause === 'workflow')
    expect(workflowRows).toHaveLength(1)
    expect(workflowRows[0].sourceId).toBe('wf-active')
  })

  it('emits a configured create-target dependent a remapped parent will clear (cause dependent)', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        { id: 'credential', title: 'Credential', type: 'oauth-input' },
        {
          id: 'folder',
          title: 'Label',
          type: 'folder-selector',
          dependsOn: ['credential'],
          selectorKey: 'gmail.labels',
        },
      ])
    )
    // Entries carry no `type`, so the credential is not a direct (category-A) reference here -
    // isolating the create-dependent (category-C) path: the label hangs off the credential.
    const result = collectForkClearedRefCandidates(
      params({
        items: [
          {
            sourceWorkflowId: 'wf-src',
            targetWorkflowId: 'wf-tgt',
            mode: 'create',
            sourceMeta: { name: 'New Workflow' },
          },
        ],
        sourceStates: new Map([
          [
            'wf-src',
            stateWith('gmail', 'Gmail', {
              credential: { value: 'cred-src' },
              folder: { value: 'INBOX' },
            }),
          ],
        ]),
        sourceLabels: new Map([['credential:cred-src', 'Work Gmail']]),
      })
    )
    expect(result).toEqual([
      {
        targetWorkflowId: 'wf-tgt',
        workflowName: 'New Workflow',
        blockId: targetBlockId,
        blockLabel: 'Gmail',
        fieldLabel: 'Label',
        kind: 'credential',
        sourceId: 'cred-src',
        sourceLabel: 'Work Gmail',
        cause: 'dependent',
        parentKind: 'credential',
        parentSourceId: 'cred-src',
      },
    ])
  })

  it('carries the knowledge-base parent on a document-selector dependent (so it can drop off)', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        {
          id: 'knowledgeBaseSelector',
          title: 'Knowledge Base',
          type: 'knowledge-base-selector',
          canonicalParamId: 'knowledgeBaseId',
        },
        {
          id: 'documentSelector',
          title: 'Document',
          type: 'document-selector',
          canonicalParamId: 'documentId',
          selectorKey: 'knowledge.documents',
          dependsOn: ['knowledgeBaseSelector'],
        },
      ])
    )
    const result = collectForkClearedRefCandidates(
      params({
        items: [
          {
            sourceWorkflowId: 'wf-src',
            targetWorkflowId: 'wf-tgt',
            mode: 'create',
            sourceMeta: { name: 'New Workflow' },
          },
        ],
        sourceStates: new Map([
          [
            'wf-src',
            stateWith('knowledge', 'Knowledge', {
              knowledgeBaseSelector: { value: 'kb-src' },
              documentSelector: { value: 'doc-src' },
            }),
          ],
        ]),
        sourceLabels: new Map([['knowledge-base:kb-src', 'Docs KB']]),
      })
    )
    expect(result).toEqual([
      {
        targetWorkflowId: 'wf-tgt',
        workflowName: 'New Workflow',
        blockId: targetBlockId,
        blockLabel: 'Knowledge',
        fieldLabel: 'Document',
        kind: 'knowledge-base',
        sourceId: 'kb-src',
        sourceLabel: 'Docs KB',
        cause: 'dependent',
        parentKind: 'knowledge-base',
        parentSourceId: 'kb-src',
      },
    ])
  })

  it('does not emit a create-target dependent the source left unset (nothing is lost)', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        { id: 'credential', title: 'Credential', type: 'oauth-input' },
        {
          id: 'folder',
          title: 'Label',
          type: 'folder-selector',
          dependsOn: ['credential'],
          selectorKey: 'gmail.labels',
        },
      ])
    )
    const result = collectForkClearedRefCandidates(
      params({
        items: [
          {
            sourceWorkflowId: 'wf-src',
            targetWorkflowId: 'wf-tgt',
            mode: 'create',
            sourceMeta: { name: 'New Workflow' },
          },
        ],
        sourceStates: new Map([
          [
            'wf-src',
            stateWith('gmail', 'Gmail', {
              credential: { value: 'cred-src' },
              folder: { value: '' },
            }),
          ],
        ]),
      })
    )
    expect(result).toEqual([])
  })

  it('does not emit create-dependents for a replace target (handled by the reconfigure flow)', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        { id: 'credential', title: 'Credential', type: 'oauth-input' },
        {
          id: 'folder',
          title: 'Label',
          type: 'folder-selector',
          dependsOn: ['credential'],
          selectorKey: 'gmail.labels',
        },
      ])
    )
    const result = collectForkClearedRefCandidates(
      params({
        items: [
          {
            sourceWorkflowId: 'wf-src',
            targetWorkflowId: 'wf-tgt',
            mode: 'replace',
            sourceMeta: { name: 'Existing' },
          },
        ],
        sourceStates: new Map([
          [
            'wf-src',
            stateWith('gmail', 'Gmail', {
              credential: { value: 'cred-src' },
              folder: { value: 'INBOX' },
            }),
          ],
        ]),
      })
    )
    // No direct refs (untyped entries) and no create-dependents (replace mode) -> empty.
    expect(result).toEqual([])
  })
})
