/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { collectForkDependentReconfigs } from '@/lib/workspaces/fork/mapping/dependent-reconfigs'
import {
  buildForkBlockIdResolver,
  deriveForkBlockId,
  EMPTY_FORK_BLOCK_MAP,
} from '@/lib/workspaces/fork/remap/block-identity'
import { getBlock } from '@/blocks/registry'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const blockWith = (subBlocks: SubBlockConfig[]): BlockConfig =>
  ({ name: 'Test', description: '', subBlocks, outputs: {} }) as unknown as BlockConfig

const sourceState = (
  blockType: string,
  subBlocks: Record<string, { value: unknown }>
): WorkflowState =>
  ({
    blocks: { 'block-1': { id: 'block-1', type: blockType, name: 'Block', subBlocks } },
    edges: [],
    loops: {},
    parallels: {},
    variables: {},
  }) as unknown as WorkflowState

const replaceItem = {
  sourceWorkflowId: 'wf-src',
  targetWorkflowId: 'wf-tgt',
  mode: 'replace' as const,
}

// No persisted block map in these unit tests, so the resolver derives - matching the
// `deriveForkBlockId(...)` ids the expectations assert.
const resolve = buildForkBlockIdResolver(true, EMPTY_FORK_BLOCK_MAP)

describe('collectForkDependentReconfigs', () => {
  it("emits the active operation's credential-dependent selector (condition-gated)", () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        { id: 'credential', title: 'Credential', type: 'oauth-input' },
        { id: 'operation', title: 'Operation', type: 'dropdown' },
        {
          id: 'folder',
          title: 'Label',
          type: 'folder-selector',
          dependsOn: ['credential'],
          selectorKey: 'gmail.labels',
          required: true,
          condition: { field: 'operation', value: 'read' },
        },
        // A different operation's variant -> excluded by its condition, not by emptiness.
        {
          id: 'otherFolder',
          title: 'Move To Label',
          type: 'folder-selector',
          dependsOn: ['credential'],
          selectorKey: 'gmail.labels',
          condition: { field: 'operation', value: 'move' },
        },
      ])
    )
    const states = new Map<string, WorkflowState>([
      [
        'wf-src',
        sourceState('gmail', {
          credential: { value: 'cred-src' },
          operation: { value: 'read' },
          folder: { value: 'INBOX' },
        }),
      ],
    ])
    const result = collectForkDependentReconfigs([replaceItem], states, resolve)
    expect(result).toEqual([
      {
        parentKind: 'credential',
        parentSourceId: 'cred-src',
        parentContextKey: 'oauthCredential',
        targetWorkflowId: 'wf-tgt',
        targetBlockId: deriveForkBlockId('wf-tgt', 'block-1'),
        blockName: 'Block',
        subBlockKey: 'folder',
        selectorKey: 'gmail.labels',
        title: 'Label',
        required: true,
        consumesContextKeys: [],
        context: {},
      },
    ])
  })

  it('emits a knowledge-base-dependent document selector', () => {
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
          required: true,
        },
      ])
    )
    const states = new Map<string, WorkflowState>([
      [
        'wf-src',
        sourceState('knowledge', {
          knowledgeBaseSelector: { value: 'kb-src' },
          documentSelector: { value: 'doc-src' },
        }),
      ],
    ])
    const result = collectForkDependentReconfigs([replaceItem], states, resolve)
    expect(result).toEqual([
      {
        parentKind: 'knowledge-base',
        parentSourceId: 'kb-src',
        parentContextKey: 'knowledgeBaseId',
        targetWorkflowId: 'wf-tgt',
        targetBlockId: deriveForkBlockId('wf-tgt', 'block-1'),
        blockName: 'Block',
        subBlockKey: 'documentSelector',
        selectorKey: 'knowledge.documents',
        title: 'Document',
        required: true,
        consumesContextKeys: [],
        context: {},
      },
    ])
  })

  it('offers an active credential selector even when the source left it empty', () => {
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
    // The source has the credential but no label - the user must still be able to set one
    // during the swap (a prior sync may have cleared it), so the selector is offered.
    const states = new Map<string, WorkflowState>([
      [
        'wf-src',
        sourceState('gmail', { credential: { value: 'cred-src' }, folder: { value: '' } }),
      ],
    ])
    const result = collectForkDependentReconfigs([replaceItem], states, resolve)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ subBlockKey: 'folder', parentSourceId: 'cred-src' })
  })

  it('still skips a selector whose parent credential is unset', () => {
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
    const states = new Map<string, WorkflowState>([
      ['wf-src', sourceState('gmail', { credential: { value: '' }, folder: { value: 'INBOX' } })],
    ])
    expect(collectForkDependentReconfigs([replaceItem], states, resolve)).toEqual([])
  })

  it('skips create-mode targets and credentialSet refs', () => {
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
    const created = new Map<string, WorkflowState>([
      [
        'wf-src',
        sourceState('gmail', { credential: { value: 'cred-src' }, folder: { value: 'INBOX' } }),
      ],
    ])
    expect(
      collectForkDependentReconfigs(
        [{ sourceWorkflowId: 'wf-src', targetWorkflowId: 'wf-tgt', mode: 'create' }],
        created,
        resolve
      )
    ).toEqual([])

    const orgSet = new Map<string, WorkflowState>([
      [
        'wf-src',
        sourceState('gmail', {
          credential: { value: 'credentialSet:cs-1' },
          folder: { value: 'INBOX' },
        }),
      ],
    ])
    expect(collectForkDependentReconfigs([replaceItem], orgSet, resolve)).toEqual([])
  })

  it('walks the transitive chain and tags the context key a re-pick provides', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        { id: 'credential', title: 'Credential', type: 'oauth-input' },
        {
          id: 'spreadsheetId',
          title: 'Spreadsheet',
          type: 'file-selector',
          canonicalParamId: 'spreadsheetId',
          selectorKey: 'google.drive',
          dependsOn: ['credential'],
        },
        {
          id: 'sheetName',
          title: 'Sheet',
          type: 'sheet-selector',
          selectorKey: 'google.sheets',
          dependsOn: ['spreadsheetId'],
          required: true,
        },
      ])
    )
    const states = new Map<string, WorkflowState>([
      [
        'wf-src',
        sourceState('google_sheets', {
          credential: { value: 'cred-src' },
          spreadsheetId: { value: 'ss-src' },
          sheetName: { value: 'Sheet1' },
        }),
      ],
    ])
    const result = collectForkDependentReconfigs([replaceItem], states, resolve)
    // Both the spreadsheet (direct) and its sheet (transitive) are offered, in order.
    expect(result.map((entry) => entry.subBlockKey)).toEqual(['spreadsheetId', 'sheetName'])
    const spreadsheet = result.find((entry) => entry.subBlockKey === 'spreadsheetId')
    expect(spreadsheet?.parentKind).toBe('credential')
    expect(spreadsheet?.providesContextKey).toBe('spreadsheetId')
    const sheet = result.find((entry) => entry.subBlockKey === 'sheetName')
    expect(sheet?.parentKind).toBe('credential')
    expect(sheet?.required).toBe(true)
    // The sheet consumes the spreadsheet's key, so the modal gates it on that re-pick.
    expect(sheet?.consumesContextKeys).toEqual(['spreadsheetId'])
    // The source spreadsheet rides in context; the modal overlays the re-picked one.
    expect(sheet?.context.spreadsheetId).toBe('ss-src')
  })

  it('emits a credential-dependent selector nested inside a tool-input tool', () => {
    vi.mocked(getBlock).mockImplementation((type) => {
      if (type === 'agent') return blockWith([{ id: 'tools', title: 'Tools', type: 'tool-input' }])
      if (type === 'gmail')
        return blockWith([
          { id: 'credential', title: 'Credential', type: 'oauth-input' },
          {
            id: 'folder',
            title: 'Label',
            type: 'folder-selector',
            dependsOn: ['credential'],
            selectorKey: 'gmail.labels',
            required: true,
          },
        ])
      return undefined as unknown as BlockConfig
    })
    const states = new Map<string, WorkflowState>([
      [
        'wf-src',
        sourceState('agent', {
          tools: {
            value: [
              {
                type: 'gmail',
                title: 'Gmail 1',
                params: { credential: 'cred-src', folder: 'INBOX' },
              },
            ],
          },
        }),
      ],
    ])
    const result = collectForkDependentReconfigs([replaceItem], states, resolve)
    expect(result).toEqual([
      {
        parentKind: 'credential',
        parentSourceId: 'cred-src',
        parentContextKey: 'oauthCredential',
        targetWorkflowId: 'wf-tgt',
        targetBlockId: deriveForkBlockId('wf-tgt', 'block-1'),
        blockName: 'Block',
        subBlockKey: 'tools[0].folder',
        selectorKey: 'gmail.labels',
        title: 'Gmail 1: Label',
        required: true,
        consumesContextKeys: [],
        context: {},
      },
    ])
  })

  it('offers a nested tool selector even when the source left it empty', () => {
    vi.mocked(getBlock).mockImplementation((type) => {
      if (type === 'agent') return blockWith([{ id: 'tools', title: 'Tools', type: 'tool-input' }])
      if (type === 'gmail')
        return blockWith([
          { id: 'credential', title: 'Credential', type: 'oauth-input' },
          {
            id: 'folder',
            title: 'Label',
            type: 'folder-selector',
            dependsOn: ['credential'],
            selectorKey: 'gmail.labels',
          },
        ])
      return undefined as unknown as BlockConfig
    })
    const states = new Map<string, WorkflowState>([
      [
        'wf-src',
        sourceState('agent', {
          tools: {
            value: [
              { type: 'gmail', title: 'Gmail 1', params: { credential: 'cred-src', folder: '' } },
            ],
          },
        }),
      ],
    ])
    const result = collectForkDependentReconfigs([replaceItem], states, resolve)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ subBlockKey: 'tools[0].folder', title: 'Gmail 1: Label' })
  })

  it('evaluates a nested tool selector condition against the tool-level operation', () => {
    vi.mocked(getBlock).mockImplementation((type) => {
      if (type === 'agent') return blockWith([{ id: 'tools', title: 'Tools', type: 'tool-input' }])
      if (type === 'gmail')
        return blockWith([
          { id: 'credential', title: 'Credential', type: 'oauth-input' },
          {
            id: 'folder',
            title: 'Label',
            type: 'folder-selector',
            dependsOn: ['credential'],
            selectorKey: 'gmail.labels',
            // Active only under read - and `operation` lives at the tool level, not params.
            condition: { field: 'operation', value: 'read_gmail' },
          },
        ])
      return undefined as unknown as BlockConfig
    })
    const reading = new Map<string, WorkflowState>([
      [
        'wf-src',
        sourceState('agent', {
          tools: {
            value: [
              {
                type: 'gmail',
                title: 'Gmail',
                operation: 'read_gmail',
                params: { credential: 'cred-src', folder: 'INBOX' },
              },
            ],
          },
        }),
      ],
    ])
    expect(collectForkDependentReconfigs([replaceItem], reading, resolve)).toHaveLength(1)

    // Same tool under a different operation -> the read-only label is gated off.
    const sending = new Map<string, WorkflowState>([
      [
        'wf-src',
        sourceState('agent', {
          tools: {
            value: [
              {
                type: 'gmail',
                title: 'Gmail',
                operation: 'send_gmail',
                params: { credential: 'cred-src', folder: 'INBOX' },
              },
            ],
          },
        }),
      ],
    ])
    expect(collectForkDependentReconfigs([replaceItem], sending, resolve)).toEqual([])
  })

  it('anchors on a table selector for its column dependents', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        {
          id: 'tableSelector',
          title: 'Table',
          type: 'table-selector',
          canonicalParamId: 'tableId',
        },
        {
          id: 'conflictColumnSelector',
          title: 'Column',
          type: 'column-selector',
          canonicalParamId: 'conflictColumn',
          selectorKey: 'table.columns',
          dependsOn: ['tableSelector'],
        },
      ])
    )
    const states = new Map<string, WorkflowState>([
      [
        'wf-src',
        sourceState('table', {
          tableSelector: { value: 'tbl-src' },
          conflictColumnSelector: { value: 'col1' },
        }),
      ],
    ])
    const result = collectForkDependentReconfigs([replaceItem], states, resolve)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      parentKind: 'table',
      parentSourceId: 'tbl-src',
      parentContextKey: 'tableId',
      subBlockKey: 'conflictColumnSelector',
      selectorKey: 'table.columns',
    })
  })
})
