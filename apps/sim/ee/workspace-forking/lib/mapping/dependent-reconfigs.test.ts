/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetToolInputParamConfigs } = vi.hoisted(() => ({
  mockGetToolInputParamConfigs: vi.fn(() => [] as unknown[]),
}))

/**
 * Mocked at the module boundary so these tests stay about the collector's own logic rather
 * than the tool/block registries the real resolver reaches into.
 */
vi.mock('@/lib/workflows/search-replace/indexer', () => ({
  getToolInputParamConfigs: mockGetToolInputParamConfigs,
}))

import { getBlock } from '@/blocks/registry'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import {
  collectForkDependentReconfigs,
  collectForkResourceUsages,
} from '@/ee/workspace-forking/lib/mapping/dependent-reconfigs'
import {
  buildForkBlockIdResolver,
  deriveForkBlockId,
  EMPTY_FORK_BLOCK_MAP,
} from '@/ee/workspace-forking/lib/remap/block-identity'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const blockWith = (subBlocks: SubBlockConfig[]): BlockConfig =>
  ({ name: 'Test', description: '', subBlocks, outputs: {} }) as unknown as BlockConfig

const sourceState = (
  blockType: string,
  subBlocks: Record<string, { value: unknown }>,
  data?: Record<string, unknown>
): WorkflowState =>
  ({
    blocks: {
      'block-1': {
        id: 'block-1',
        type: blockType,
        name: 'Block',
        subBlocks,
        ...(data && { data }),
      },
    },
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

/**
 * No persisted block map in these unit tests, so the resolver derives - matching the
 * `deriveForkBlockId(...)` ids the expectations assert.
 */
const resolve = buildForkBlockIdResolver(true, EMPTY_FORK_BLOCK_MAP)

/**
 * The indexer mock is module-scoped, so a `mockReturnValue` from one test would otherwise
 * leak into the next and make these order-dependent. Reset to the empty (no authoritative
 * visibility) default before each.
 */
beforeEach(() => {
  mockGetToolInputParamConfigs.mockReset()
  mockGetToolInputParamConfigs.mockReturnValue([])
})

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
        currentValue: 'INBOX',
        required: true,
        consumesContextKeys: [],
        context: {},
        sourceValue: 'INBOX',
      },
    ])
  })

  it('anchors duplicate trigger selectors to the active trigger credential', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        {
          id: 'credential',
          title: 'Credential',
          type: 'oauth-input',
          canonicalParamId: 'oauthCredential',
          mode: 'basic',
        },
        {
          id: 'workspacePicker',
          title: 'Workspace',
          type: 'project-selector',
          canonicalParamId: 'workspaceSlug',
          selectorKey: 'bitbucket.workspaces',
          dependsOn: ['credential'],
          mode: 'basic',
        },
        {
          id: 'selectedTriggerId',
          title: 'Trigger Type',
          type: 'dropdown',
          mode: 'trigger',
        },
        {
          id: 'triggerCredentials',
          title: 'Trigger Credential',
          type: 'oauth-input',
          canonicalParamId: 'oauthCredential',
          mode: 'trigger',
          condition: { field: 'selectedTriggerId', value: 'bitbucket_push' },
        },
        {
          id: 'workspacePicker',
          title: 'Workspace',
          type: 'project-selector',
          canonicalParamId: 'workspaceSlug',
          selectorKey: 'bitbucket.workspaces',
          dependsOn: ['triggerCredentials'],
          mode: 'trigger',
          condition: { field: 'selectedTriggerId', value: 'bitbucket_push' },
        },
        {
          id: 'triggerCredentials',
          title: 'Trigger Credential',
          type: 'oauth-input',
          canonicalParamId: 'oauthCredential',
          mode: 'trigger',
          condition: { field: 'selectedTriggerId', value: 'bitbucket_pull_request_created' },
        },
        {
          id: 'workspacePicker',
          title: 'Workspace',
          type: 'project-selector',
          canonicalParamId: 'workspaceSlug',
          selectorKey: 'bitbucket.workspaces',
          dependsOn: ['triggerCredentials'],
          mode: 'trigger',
          condition: { field: 'selectedTriggerId', value: 'bitbucket_pull_request_created' },
        },
      ])
    )
    const state = sourceState('bitbucket', {
      credential: { value: 'dormant-action-credential' },
      selectedTriggerId: { value: 'bitbucket_push' },
      triggerCredentials: { value: 'active-trigger-credential' },
      workspacePicker: { value: 'acme' },
    })
    state.blocks['block-1'].triggerMode = true

    const result = collectForkDependentReconfigs(
      [replaceItem],
      new Map([['wf-src', state]]),
      resolve
    )

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      parentSourceId: 'active-trigger-credential',
      subBlockKey: 'workspacePicker',
      currentValue: 'acme',
    })
  })

  it('skips an anchor whose canonical pair is in advanced (manual) mode - the value passes through', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        {
          id: 'knowledgeBaseSelector',
          title: 'Knowledge Base',
          type: 'knowledge-base-selector',
          canonicalParamId: 'knowledgeBaseId',
          mode: 'basic',
        },
        {
          id: 'manualKnowledgeBaseId',
          title: 'KB ID',
          type: 'short-input',
          canonicalParamId: 'knowledgeBaseId',
          mode: 'advanced',
        },
        {
          id: 'documentSelector',
          title: 'Document',
          type: 'document-selector',
          selectorKey: 'knowledge.documents',
          dependsOn: ['knowledgeBaseSelector'],
          required: true,
        },
      ])
    )
    // Advanced mode active: the dormant basic selector is empty; the active manual id holds the KB.
    const advancedState = {
      blocks: {
        'block-1': {
          id: 'block-1',
          type: 'knowledge',
          name: 'Block',
          data: { canonicalModes: { knowledgeBaseId: 'advanced' } },
          subBlocks: {
            knowledgeBaseSelector: { value: '' },
            manualKnowledgeBaseId: { value: 'kb-active' },
            documentSelector: { value: 'doc-1' },
          },
        },
      },
      edges: [],
      loops: {},
      parallels: {},
      variables: {},
    } as unknown as WorkflowState
    const result = collectForkDependentReconfigs(
      [replaceItem],
      new Map([['wf-src', advancedState]]),
      resolve
    )
    // Advanced (manual) mode: the manual KB id is user-owned and passes through verbatim on
    // sync - it is never remapped, so its dependents are never cleared and there is nothing
    // to re-pick. No reconfig is offered.
    expect(result).toEqual([])
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
        currentValue: 'doc-src',
        required: true,
        consumesContextKeys: [],
        context: {},
        sourceValue: 'doc-src',
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

  it('skips create-mode targets', () => {
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

  it('offers a plain text dependent of a remapped credential', () => {
    // `clearDependentsOnRemap` wipes it on EVERY sync (a credential mapped across environments
    // changes value each time), so a text field the modal never offered was re-emptied on every
    // push with nowhere to set it that stuck.
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        { id: 'credential', title: 'Credential', type: 'oauth-input' },
        {
          id: 'issueType',
          title: 'Issue Type',
          type: 'short-input',
          dependsOn: ['credential'],
        },
      ])
    )
    const states = new Map<string, WorkflowState>([
      [
        'wf-src',
        sourceState('jira', { credential: { value: 'cred-src' }, issueType: { value: 'Bug' } }),
      ],
    ])
    const fields = collectForkDependentReconfigs([replaceItem], states, resolve)
    expect(fields).toHaveLength(1)
    expect(fields[0]).toMatchObject({ subBlockKey: 'issueType', fieldType: 'short-input' })
    expect(fields[0].selectorKey).toBeUndefined()
  })

  it('does not offer the manual half of a selector-backed canonical pair', () => {
    // The pair's selector member already represents the field, and the manual member is
    // verbatim by policy — offering both shows one concept twice and invites writing into the
    // inactive half.
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        { id: 'credential', title: 'Credential', type: 'oauth-input' },
        {
          id: 'projectId',
          title: 'Project',
          type: 'project-selector',
          canonicalParamId: 'projectId',
          mode: 'basic',
          selectorKey: 'jira.projects',
          dependsOn: ['credential'],
        },
        {
          id: 'manualProjectId',
          title: 'Project ID',
          type: 'short-input',
          canonicalParamId: 'projectId',
          mode: 'advanced',
          dependsOn: ['credential'],
        },
      ])
    )
    const states = new Map<string, WorkflowState>([
      [
        'wf-src',
        sourceState('jira', { credential: { value: 'cred-src' }, projectId: { value: 'PROJ' } }),
      ],
    ])
    const keys = collectForkDependentReconfigs([replaceItem], states, resolve).map(
      (field) => field.subBlockKey
    )
    expect(keys).toContain('projectId')
    expect(keys).not.toContain('manualProjectId')
  })

  it('uses the persisted canonical mode when building a dependent selector context', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        { id: 'credential', title: 'Credential', type: 'oauth-input' },
        { id: 'domain', title: 'Domain', type: 'short-input' },
        {
          id: 'projectId',
          title: 'Project',
          type: 'project-selector',
          canonicalParamId: 'projectId',
          mode: 'basic',
          selectorKey: 'jira.projects',
          dependsOn: ['credential', 'domain'],
        },
        {
          id: 'manualProjectId',
          title: 'Project ID',
          type: 'short-input',
          canonicalParamId: 'projectId',
          mode: 'advanced',
          dependsOn: ['credential', 'domain'],
        },
        {
          id: 'issueKey',
          title: 'Issue',
          type: 'file-selector',
          selectorKey: 'jira.issues',
          dependsOn: ['credential', 'domain', 'projectId'],
          required: true,
        },
      ])
    )
    const states = new Map<string, WorkflowState>([
      [
        'wf-src',
        sourceState(
          'jira',
          {
            credential: { value: 'cred-src' },
            domain: { value: 'example.atlassian.net' },
            projectId: { value: 'project-basic-stale' },
            manualProjectId: { value: 'project-advanced' },
            issueKey: { value: 'ADV-1' },
          },
          { canonicalModes: { projectId: 'advanced' } }
        ),
      ],
    ])

    const result = collectForkDependentReconfigs([replaceItem], states, resolve)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      subBlockKey: 'issueKey',
      context: {
        domain: 'example.atlassian.net',
        projectId: 'project-advanced',
      },
    })
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
        title: 'Label',
        toolName: 'Gmail 1',
        dependencyScope: 'tools[0]',
        currentValue: 'INBOX',
        required: true,
        consumesContextKeys: [],
        context: {},
        sourceValue: 'INBOX',
      },
    ])
  })

  it('preserves dependency chains independently for duplicate nested tool instances', () => {
    vi.mocked(getBlock).mockImplementation((type) => {
      if (type === 'agent') return blockWith([{ id: 'tools', title: 'Tools', type: 'tool-input' }])
      if (type === 'jira')
        return blockWith([
          {
            id: 'credential',
            title: 'Jira Account',
            type: 'oauth-input',
            canonicalParamId: 'oauthCredential',
          },
          {
            id: 'projectId',
            title: 'Project',
            type: 'project-selector',
            canonicalParamId: 'projectId',
            selectorKey: 'jira.projects',
            dependsOn: ['credential'],
          },
          {
            id: 'issueKey',
            title: 'Issue',
            type: 'file-selector',
            selectorKey: 'jira.issues',
            dependsOn: ['credential', 'projectId'],
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
                type: 'jira',
                title: 'Jira',
                params: { credential: 'cred-src', projectId: 'P1', issueKey: 'P1-1' },
              },
              {
                type: 'jira',
                title: 'Jira',
                params: { credential: 'cred-src', projectId: 'P2', issueKey: 'P2-1' },
              },
            ],
          },
        }),
      ],
    ])

    const result = collectForkDependentReconfigs([replaceItem], states, resolve)

    expect(
      result.map((entry) => ({
        key: entry.subBlockKey,
        scope: entry.dependencyScope,
        provides: entry.providesContextKey,
        consumes: entry.consumesContextKeys,
      }))
    ).toEqual([
      {
        key: 'tools[0].projectId',
        scope: 'tools[0]',
        provides: 'projectId',
        consumes: [],
      },
      {
        key: 'tools[0].issueKey',
        scope: 'tools[0]',
        provides: undefined,
        consumes: ['projectId'],
      },
      {
        key: 'tools[1].projectId',
        scope: 'tools[1]',
        provides: 'projectId',
        consumes: [],
      },
      {
        key: 'tools[1].issueKey',
        scope: 'tools[1]',
        provides: undefined,
        consumes: ['projectId'],
      },
    ])
  })

  it('honors a nested tool-scoped advanced override (manual mode passes through - no re-pick)', () => {
    vi.mocked(getBlock).mockImplementation((type) => {
      if (type === 'agent') return blockWith([{ id: 'tools', title: 'Tools', type: 'tool-input' }])
      if (type === 'gmail')
        return blockWith([
          {
            id: 'credential',
            title: 'Credential',
            type: 'oauth-input',
            canonicalParamId: 'credential',
            mode: 'basic',
          },
          {
            id: 'manualCredential',
            title: 'Credential ID',
            type: 'short-input',
            canonicalParamId: 'credential',
            mode: 'advanced',
          },
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
    // Agent block with a nested gmail tool; the dormant basic credential holds a stale id while the
    // tool-scoped `0:credential` override (when present) marks advanced as active.
    const agentState = (canonicalModes?: Record<string, 'basic' | 'advanced'>) =>
      ({
        blocks: {
          'block-1': {
            id: 'block-1',
            type: 'agent',
            name: 'Block',
            data: canonicalModes ? { canonicalModes } : {},
            subBlocks: {
              tools: {
                value: [
                  {
                    type: 'gmail',
                    title: 'Gmail 1',
                    params: {
                      credential: 'cred-stale',
                      manualCredential: 'cred-active',
                      folder: 'INBOX',
                    },
                  },
                ],
              },
            },
          },
        },
        edges: [],
        loops: {},
        parallels: {},
        variables: {},
      }) as unknown as WorkflowState

    // Scoped override present -> advanced (manual) mode: the manual credential passes through
    // verbatim on sync, so its dependents are never cleared and no re-pick is offered.
    const withOverride = collectForkDependentReconfigs(
      [replaceItem],
      new Map([['wf-src', agentState({ '0:credential': 'advanced' })]]),
      resolve
    )
    expect(withOverride).toEqual([])

    // Control: no override -> the value heuristic keeps the non-empty basic (unchanged behavior).
    const heuristic = collectForkDependentReconfigs(
      [replaceItem],
      new Map([['wf-src', agentState()]]),
      resolve
    )
    expect(heuristic).toHaveLength(1)
    expect(heuristic[0]).toMatchObject({
      parentSourceId: 'cred-stale',
      subBlockKey: 'tools[0].folder',
    })
  })

  it('regression: two same-type nested tools resolve their canonical-mode override independently', () => {
    vi.mocked(getBlock).mockImplementation((type) => {
      if (type === 'agent') return blockWith([{ id: 'tools', title: 'Tools', type: 'tool-input' }])
      if (type === 'gmail')
        return blockWith([
          {
            id: 'credential',
            title: 'Credential',
            type: 'oauth-input',
            canonicalParamId: 'credential',
            mode: 'basic',
          },
          {
            id: 'manualCredential',
            title: 'Credential ID',
            type: 'short-input',
            canonicalParamId: 'credential',
            mode: 'advanced',
          },
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
        {
          blocks: {
            'block-1': {
              id: 'block-1',
              type: 'agent',
              name: 'Block',
              // Tool #0 is scoped to advanced (manual mode passes through - no re-pick, per the
              // test above); tool #1 is scoped to basic (re-pick offered on its own value). Both
              // are the SAME tool type ("gmail") and the SAME canonicalId ("credential"), so only
              // the per-instance index can tell them apart - before the fix both shared the single
              // `gmail:credential` key, which would have made tool #1 advanced-active too (and
              // therefore ALSO skipped, dropping the result to zero entries instead of one).
              data: { canonicalModes: { '0:credential': 'advanced', '1:credential': 'basic' } },
              subBlocks: {
                tools: {
                  value: [
                    {
                      type: 'gmail',
                      title: 'Gmail 1',
                      params: {
                        credential: 'cred-0-stale',
                        manualCredential: 'cred-0-active',
                        folder: 'INBOX',
                      },
                    },
                    {
                      type: 'gmail',
                      title: 'Gmail 2',
                      params: {
                        credential: 'cred-1-basic',
                        manualCredential: 'cred-1-stale',
                        folder: 'SENT',
                      },
                    },
                  ],
                },
              },
            },
          },
          edges: [],
          loops: {},
          parallels: {},
          variables: {},
        } as unknown as WorkflowState,
      ],
    ])

    const result = collectForkDependentReconfigs([replaceItem], states, resolve)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      parentSourceId: 'cred-1-basic',
      subBlockKey: 'tools[1].folder',
    })
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
    expect(result[0]).toMatchObject({
      subBlockKey: 'tools[0].folder',
      title: 'Label',
      toolName: 'Gmail 1',
    })
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

/**
 * A sync carries the source's configuration across; it never invents configuration the
 * source never had. A blank selector is still OFFERED (so it can be set in place during the
 * swap) but must not gate the sync.
 */
describe('collectForkDependentReconfigs — blank source values never gate', () => {
  const jiraProjectBlock = () =>
    blockWith([
      { id: 'credential', title: 'Credential', type: 'oauth-input' },
      { id: 'operation', title: 'Operation', type: 'dropdown' },
      {
        id: 'projectId',
        title: 'Select Project',
        type: 'project-selector',
        canonicalParamId: 'projectId',
        selectorKey: 'jira.projects',
        dependsOn: ['credential'],
        mode: 'basic',
        required: { field: 'operation', value: ['write'] },
      },
      // The advanced twin carries the SAME `required` but no `selectorKey`, so it is never
      // emitted. That asymmetry is what made an identical blank config gate or not gate
      // purely on a display preference.
      {
        id: 'manualProjectId',
        title: 'Project ID',
        type: 'short-input',
        canonicalParamId: 'projectId',
        dependsOn: ['credential'],
        mode: 'advanced',
        required: { field: 'operation', value: ['write'] },
      },
    ])

  it('offers a blank required selector but does not mark it required', () => {
    vi.mocked(getBlock).mockReturnValue(jiraProjectBlock())
    const states = new Map<string, WorkflowState>([
      [
        'wf-src',
        sourceState('jira', {
          credential: { value: 'cred-src' },
          operation: { value: 'write' },
          projectId: { value: '' },
        }),
      ],
    ])
    const result = collectForkDependentReconfigs([replaceItem], states, resolve)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ subBlockKey: 'projectId', required: false, sourceValue: '' })
  })

  it('still marks a populated required selector as required', () => {
    vi.mocked(getBlock).mockReturnValue(jiraProjectBlock())
    const states = new Map<string, WorkflowState>([
      [
        'wf-src',
        sourceState('jira', {
          credential: { value: 'cred-src' },
          operation: { value: 'write' },
          projectId: { value: 'PROJ-1' },
        }),
      ],
    ])
    const result = collectForkDependentReconfigs([replaceItem], states, resolve)
    expect(result[0]).toMatchObject({ subBlockKey: 'projectId', required: true })
  })

  it('still gates a dependent whose source value is a non-string', () => {
    // A multi-select selector (e.g. zoho-desk `departmentIds`) stores an array. The wire
    // `sourceValue` coerces non-strings to '' - if the emptiness check read that coerced
    // value, a populated multi-select would report blank and silently stop gating.
    vi.mocked(getBlock).mockReturnValue(jiraProjectBlock())
    const states = new Map<string, WorkflowState>([
      [
        'wf-src',
        sourceState('jira', {
          credential: { value: 'cred-src' },
          operation: { value: 'write' },
          projectId: { value: ['PROJ-1'] as unknown as string },
        }),
      ],
    ])
    const result = collectForkDependentReconfigs([replaceItem], states, resolve)
    expect(result[0]).toMatchObject({ subBlockKey: 'projectId', required: true })
  })

  it('does not gate a dependent whose source value is an empty array', () => {
    vi.mocked(getBlock).mockReturnValue(jiraProjectBlock())
    const states = new Map<string, WorkflowState>([
      [
        'wf-src',
        sourceState('jira', {
          credential: { value: 'cred-src' },
          operation: { value: 'write' },
          projectId: { value: [] as unknown as string },
        }),
      ],
    ])
    const result = collectForkDependentReconfigs([replaceItem], states, resolve)
    expect(result[0]).toMatchObject({ subBlockKey: 'projectId', required: false })
  })

  it('reaches the same verdict in basic and advanced canonical mode', () => {
    vi.mocked(getBlock).mockReturnValue(jiraProjectBlock())
    const blankSubBlocks = {
      credential: { value: 'cred-src' },
      operation: { value: 'write' },
      projectId: { value: '' },
      manualProjectId: { value: '' },
    }
    const basic = sourceState('jira', blankSubBlocks)
    const advanced = sourceState('jira', blankSubBlocks) as unknown as WorkflowState & {
      blocks: Record<string, { data?: Record<string, unknown> }>
    }
    advanced.blocks['block-1'].data = { canonicalModes: { projectId: 'advanced' } }

    const basicResult = collectForkDependentReconfigs(
      [replaceItem],
      new Map([['wf-src', basic]]),
      resolve
    )
    const advancedResult = collectForkDependentReconfigs(
      [replaceItem],
      new Map([['wf-src', advanced as unknown as WorkflowState]]),
      resolve
    )
    // Advanced drops the row entirely (the dormant-member guard), basic keeps it but
    // non-blocking. Pin BOTH shapes, not just `.every(...)`: over an empty array `.every`
    // is vacuously true, so an advanced path that regressed to emitting a required row
    // would still pass.
    expect(basicResult).toHaveLength(1)
    expect(basicResult[0]).toMatchObject({ subBlockKey: 'projectId', required: false })
    expect(advancedResult).toHaveLength(0)
  })
})

/**
 * Inside a `tool-input`, only a `user-only` param is the user's to supply. A `user-or-llm`
 * or `llm-only` param is filled by the model at runtime (`createLLMToolSchema` keeps an empty
 * one in the schema handed to the model), so a blank value there is a deliberate
 * configuration state and must never gate a sync.
 */
describe('collectForkDependentReconfigs — nested tool params follow ParameterVisibility', () => {
  const agentWithJiraTool = () =>
    vi.mocked(getBlock).mockImplementation((type) => {
      if (type === 'agent') return blockWith([{ id: 'tools', title: 'Tools', type: 'tool-input' }])
      if (type === 'jira')
        return blockWith([
          { id: 'credential', title: 'Credential', type: 'oauth-input' },
          {
            id: 'issueKey',
            title: 'Select Issue',
            type: 'file-selector',
            canonicalParamId: 'issueKey',
            selectorKey: 'jira.issues',
            dependsOn: ['credential'],
            required: true,
          },
          {
            id: 'domain',
            title: 'Domain',
            type: 'short-input',
            selectorKey: 'jira.domains',
            dependsOn: ['credential'],
            required: true,
          },
        ])
      return undefined as unknown as BlockConfig
    })

  const stateWithIssueKey = (issueKey: string) =>
    new Map<string, WorkflowState>([
      [
        'wf-src',
        sourceState('agent', {
          tools: {
            value: [
              {
                type: 'jira',
                title: 'Jira',
                operation: 'read',
                params: { credential: 'cred-src', domain: 'acme.atlassian.net', issueKey },
              },
            ],
          },
        }),
      ],
    ])

  const resolvedParams = (visibilityByParam: Record<string, string>) =>
    Object.entries(visibilityByParam).map(([paramId, paramVisibility]) => ({
      paramId,
      authoritative: true,
      config: { id: paramId, type: 'short-input', paramVisibility },
      value: undefined,
    }))

  it('does not require a blank user-or-llm param the agent fills at runtime', () => {
    agentWithJiraTool()
    mockGetToolInputParamConfigs.mockReturnValue(
      resolvedParams({ issueKey: 'user-or-llm', domain: 'user-only' })
    )
    const result = collectForkDependentReconfigs([replaceItem], stateWithIssueKey(''), resolve)
    const issue = result.find((f) => f.subBlockKey === 'tools[0].issueKey')
    expect(issue).toMatchObject({ required: false, toolName: 'Jira' })
  })

  it('does not require a POPULATED user-or-llm param either', () => {
    // Visibility, not emptiness, is the rule here. A parent swap blanks this field in the
    // modal (`effectiveDependentValue`), so an emptiness-only guard would still gate it.
    agentWithJiraTool()
    mockGetToolInputParamConfigs.mockReturnValue(
      resolvedParams({ issueKey: 'user-or-llm', domain: 'user-only' })
    )
    const result = collectForkDependentReconfigs(
      [replaceItem],
      stateWithIssueKey('ACME-999'),
      resolve
    )
    const issue = result.find((f) => f.subBlockKey === 'tools[0].issueKey')
    expect(issue).toMatchObject({ required: false, sourceValue: 'ACME-999' })
  })

  it('still requires a populated user-only param', () => {
    agentWithJiraTool()
    mockGetToolInputParamConfigs.mockReturnValue(
      resolvedParams({ issueKey: 'user-or-llm', domain: 'user-only' })
    )
    const result = collectForkDependentReconfigs(
      [replaceItem],
      stateWithIssueKey('ACME-999'),
      resolve
    )
    const domain = result.find((f) => f.subBlockKey === 'tools[0].domain')
    expect(domain).toMatchObject({ required: true })
  })

  it('falls back to the block-level required when no authoritative visibility exists', () => {
    // custom-tool / MCP / unresolvable tool id -> the resolver has no authoritative entry.
    // Fail closed: keep the pre-existing gate rather than silently un-gating an unknown schema.
    agentWithJiraTool()
    mockGetToolInputParamConfigs.mockReturnValue([])
    const result = collectForkDependentReconfigs(
      [replaceItem],
      stateWithIssueKey('ACME-999'),
      resolve
    )
    const issue = result.find((f) => f.subBlockKey === 'tools[0].issueKey')
    expect(issue).toMatchObject({ required: true })
  })

  it('ignores a non-authoritative visibility rather than trusting it to un-gate', () => {
    // A generic/inferred entry carries no reliable annotation, so it must not be able to
    // turn a gating field into a non-gating one.
    agentWithJiraTool()
    mockGetToolInputParamConfigs.mockReturnValue([
      {
        paramId: 'issueKey',
        authoritative: false,
        config: { id: 'issueKey', type: 'short-input', paramVisibility: 'user-or-llm' },
        value: undefined,
      },
    ])
    const result = collectForkDependentReconfigs(
      [replaceItem],
      stateWithIssueKey('ACME-999'),
      resolve
    )
    expect(result.find((f) => f.subBlockKey === 'tools[0].issueKey')).toMatchObject({
      required: true,
    })
  })

  it('fails closed when an authoritative entry carries no visibility', () => {
    // The real resolver's `uncoveredParams` branch builds its config via
    // `buildToolInputSearchConfig`, which does NOT copy `paramVisibility` - so the map holds
    // the key with an `undefined` value. That must fall back to the block-level `required`,
    // not be read as "not user-only".
    agentWithJiraTool()
    mockGetToolInputParamConfigs.mockReturnValue([
      {
        paramId: 'issueKey',
        authoritative: true,
        config: { id: 'issueKey', type: 'short-input' },
        value: undefined,
      },
    ])
    const result = collectForkDependentReconfigs(
      [replaceItem],
      stateWithIssueKey('ACME-999'),
      resolve
    )
    expect(result.find((f) => f.subBlockKey === 'tools[0].issueKey')).toMatchObject({
      required: true,
    })
  })

  it('resolves visibility through the canonical param id when the sub-block id differs', () => {
    // The resolver keys by its own paramId; a canonical pair's sub-block id can differ, so the
    // map is double-keyed and the lookup falls back to `canonicalParamId`.
    vi.mocked(getBlock).mockImplementation((type) => {
      if (type === 'agent') return blockWith([{ id: 'tools', title: 'Tools', type: 'tool-input' }])
      if (type === 'jira')
        return blockWith([
          { id: 'credential', title: 'Credential', type: 'oauth-input' },
          {
            id: 'issueKeySelector',
            title: 'Select Issue',
            type: 'file-selector',
            canonicalParamId: 'issueKey',
            selectorKey: 'jira.issues',
            dependsOn: ['credential'],
            required: true,
          },
        ])
      return undefined as unknown as BlockConfig
    })
    mockGetToolInputParamConfigs.mockReturnValue([
      {
        paramId: 'issueKey',
        authoritative: true,
        config: { id: 'issueKey', type: 'file-selector', paramVisibility: 'user-or-llm' },
        value: undefined,
      },
    ])
    const result = collectForkDependentReconfigs(
      [replaceItem],
      stateWithIssueKey('ACME-999'),
      resolve
    )
    // Found via canonicalParamId -> user-or-llm -> not the user's to fill.
    expect(result.find((f) => f.subBlockKey === 'tools[0].issueKeySelector')).toMatchObject({
      required: false,
    })
  })

  it('does not gate a blank user-only nested param', () => {
    // Both invariants fire at once: user-only (so visibility would gate) but blank in the
    // source (so there is nothing to carry across).
    agentWithJiraTool()
    mockGetToolInputParamConfigs.mockReturnValue(
      resolvedParams({ issueKey: 'user-or-llm', domain: 'user-only' })
    )
    const states = new Map<string, WorkflowState>([
      [
        'wf-src',
        sourceState('agent', {
          tools: {
            value: [
              {
                type: 'jira',
                title: 'Jira',
                operation: 'read',
                params: { credential: 'cred-src', domain: '', issueKey: '' },
              },
            ],
          },
        }),
      ],
    ])
    const result = collectForkDependentReconfigs([replaceItem], states, resolve)
    expect(result.find((f) => f.subBlockKey === 'tools[0].domain')).toMatchObject({
      required: false,
    })
  })
})

describe('collectForkResourceUsages', () => {
  const usageItem = (
    sourceWorkflowId: string,
    targetWorkflowId: string,
    name: string,
    mode: 'create' | 'replace' = 'replace'
  ) => ({ sourceWorkflowId, targetWorkflowId, mode, sourceMeta: { name } })

  // The reference scan reads each subblock entry's own `type`, so credential usages need
  // typed entries (unlike the dependent collector, which keys off the block config).
  const credentialState = (credentialId: string): WorkflowState =>
    ({
      blocks: {
        'block-1': {
          id: 'block-1',
          type: 'gmail',
          name: 'Block',
          subBlocks: { credential: { id: 'credential', type: 'oauth-input', value: credentialId } },
        },
      },
      edges: [],
      loops: {},
      parallels: {},
      variables: {},
    }) as unknown as WorkflowState

  it('lists each replace workflow a resource is used in, with its (target) name', () => {
    const states = new Map<string, WorkflowState>([
      ['wf-a', credentialState('cred-src')],
      ['wf-b', credentialState('cred-src')],
    ])
    const result = collectForkResourceUsages(
      [usageItem('wf-a', 'wf-tgt-a', 'Workflow A'), usageItem('wf-b', 'wf-tgt-b', 'Workflow B')],
      states
    )
    expect(result).toEqual([
      {
        parentKind: 'credential',
        parentSourceId: 'cred-src',
        workflows: [
          { workflowId: 'wf-tgt-a', workflowName: 'Workflow A' },
          { workflowId: 'wf-tgt-b', workflowName: 'Workflow B' },
        ],
      },
    ])
  })

  it('includes create-mode targets (never-synced workflows count toward the next sync)', () => {
    const states = new Map<string, WorkflowState>([['wf-a', credentialState('cred-src')]])
    expect(
      collectForkResourceUsages([usageItem('wf-a', 'wf-tgt-a', 'A', 'create')], states)
    ).toEqual([
      {
        parentKind: 'credential',
        parentSourceId: 'cred-src',
        workflows: [{ workflowId: 'wf-tgt-a', workflowName: 'A' }],
      },
    ])
  })
})
