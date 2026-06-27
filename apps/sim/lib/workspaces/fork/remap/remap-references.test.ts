/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'

// The indexer resolves a tool's params via the tool registry; stub it so the
// injected blockConfigs subBlocks drive resolution deterministically in tests.
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

import type { SubBlockRecord } from '@/lib/workflows/persistence/remap-internal-ids'
import {
  applyDependentOverrides,
  collectClearedDependents,
  preserveStableDependents,
  remapForkSubBlocks,
  remapToolBlockResources,
} from '@/lib/workspaces/fork/remap/remap-references'
import { getBlock } from '@/blocks/registry'

const blockConfigs: Record<string, { subBlocks: SubBlockConfig[] }> = {
  testblock: {
    subBlocks: [
      { id: 'credential', title: 'Credential', type: 'oauth-input', serviceId: 'gmail' },
      { id: 'knowledgeBaseId', title: 'KB', type: 'knowledge-base-selector' },
      { id: 'channel', title: 'Channel', type: 'channel-selector', serviceId: 'slack' },
    ],
  },
}

describe('remapToolBlockResources', () => {
  it('remaps nested credential + knowledge-base ids and leaves external selectors', () => {
    const tool = {
      type: 'testblock',
      toolId: 'testblock_run',
      params: { credential: 'cred-src', knowledgeBaseId: 'kb-src', channel: 'C123' },
    }
    const map: Record<string, string> = {
      'credential:cred-src': 'cred-dst',
      'knowledge-base:kb-src': 'kb-dst',
    }
    const result = remapToolBlockResources(tool, {
      resolve: (kind, id) => map[`${kind}:${id}`] ?? null,
      resolveFileKey: () => null,
      clearUnresolved: false,
      blockConfigs,
    })
    expect(result.params).toEqual({
      credential: 'cred-dst',
      knowledgeBaseId: 'kb-dst',
      channel: 'C123',
    })
  })

  it('clears unresolved copyable refs when clearUnresolved is set (fork)', () => {
    const tool = {
      type: 'testblock',
      toolId: 'testblock_run',
      params: { credential: 'cred-src', knowledgeBaseId: 'kb-src', channel: 'C123' },
    }
    const result = remapToolBlockResources(tool, {
      resolve: () => null,
      resolveFileKey: () => null,
      clearUnresolved: true,
      blockConfigs,
    })
    expect(result.params).toEqual({ credential: '', knowledgeBaseId: '', channel: 'C123' })
  })

  it('keeps unresolved refs and records them when not clearing (promote)', () => {
    const tool = {
      type: 'testblock',
      toolId: 'testblock_run',
      params: { credential: 'cred-src', channel: 'C123' },
    }
    const recorded: Array<{ kind: string; id: string; mapped: boolean }> = []
    const result = remapToolBlockResources(tool, {
      resolve: () => null,
      resolveFileKey: () => null,
      record: (kind, id, mapped) => recorded.push({ kind, id, mapped }),
      clearUnresolved: false,
      blockConfigs,
    })
    expect((result.params as Record<string, unknown>).credential).toBe('cred-src')
    expect(recorded).toContainEqual({ kind: 'credential', id: 'cred-src', mapped: false })
  })

  it('returns the tool unchanged when it has no params', () => {
    const tool = { type: 'testblock' }
    expect(
      remapToolBlockResources(tool, {
        resolve: () => null,
        resolveFileKey: () => null,
        clearUnresolved: true,
        blockConfigs,
      })
    ).toBe(tool)
  })

  it('leaves an advanced-mode manualCredential id untouched (escape hatch)', () => {
    const tool = {
      type: 'testblock',
      toolId: 'testblock_run',
      params: { manualCredential: 'mc-src', knowledgeBaseId: 'kb-src' },
    }
    const result = remapToolBlockResources(tool, {
      resolve: (kind, id) => (kind === 'knowledge-base' && id === 'kb-src' ? 'kb-dst' : null),
      resolveFileKey: () => null,
      clearUnresolved: true,
      blockConfigs,
    })
    expect(result.params).toEqual({ manualCredential: 'mc-src', knowledgeBaseId: 'kb-dst' })
  })

  it('preserves an org-scoped credentialSet ref without remapping or recording it', () => {
    const tool = {
      type: 'testblock',
      toolId: 'testblock_run',
      params: { credential: 'credentialSet:cs-1' },
    }
    const recorded: Array<{ kind: string; id: string; mapped: boolean }> = []
    const result = remapToolBlockResources(tool, {
      resolve: () => null,
      resolveFileKey: () => null,
      record: (kind, id, mapped) => recorded.push({ kind, id, mapped }),
      clearUnresolved: true,
      blockConfigs,
    })
    expect((result.params as Record<string, string>).credential).toBe('credentialSet:cs-1')
    expect(recorded).toHaveLength(0)
  })

  it('drops only the uncopied entry in a mixed multi-value field', () => {
    const tool = {
      type: 'testblock',
      toolId: 'testblock_run',
      params: { knowledgeBaseId: 'kb1,kb2' },
    }
    const result = remapToolBlockResources(tool, {
      resolve: (_kind, id) => (id === 'kb1' ? 'kb1-dst' : null),
      resolveFileKey: () => null,
      clearUnresolved: true,
      blockConfigs,
    })
    const value = (result.params as Record<string, string>).knowledgeBaseId
    expect(value.split(',').filter(Boolean)).toEqual(['kb1-dst'])
  })

  it('resolves a credential param by id even when its config is filtered out (reactive)', () => {
    // blockConfigs has no `credential` subBlock (simulating a reactive-gated field
    // hidden from getToolInputParamConfigs); the raw id-scan must still catch it.
    const tool = {
      type: 'reactiveblock',
      toolId: 'reactiveblock_run',
      params: { credential: 'cred-src' },
    }
    const result = remapToolBlockResources(tool, {
      resolve: (kind, id) => (kind === 'credential' && id === 'cred-src' ? 'cred-dst' : null),
      resolveFileKey: () => null,
      clearUnresolved: false,
      blockConfigs: { reactiveblock: { subBlocks: [] } },
    })
    expect((result.params as Record<string, string>).credential).toBe('cred-dst')
  })

  it('clears a dependent tool param when its parent resource is remapped', () => {
    const tool = {
      type: 'depblock',
      toolId: 'depblock_run',
      params: { knowledgeBaseId: 'kb-src', documentId: 'doc-src' },
    }
    const result = remapToolBlockResources(tool, {
      resolve: (kind, id) => (kind === 'knowledge-base' && id === 'kb-src' ? 'kb-dst' : null),
      resolveFileKey: () => null,
      clearUnresolved: false,
      blockConfigs: {
        depblock: {
          subBlocks: [
            { id: 'knowledgeBaseId', title: 'KB', type: 'knowledge-base-selector' },
            {
              id: 'documentId',
              title: 'Doc',
              type: 'document-selector',
              dependsOn: ['knowledgeBaseId'],
            },
          ],
        },
      },
    })
    expect(result.params).toEqual({ knowledgeBaseId: 'kb-dst', documentId: '' })
  })
})

describe('remapForkSubBlocks', () => {
  const subBlocks = (): SubBlockRecord => ({
    credential: { id: 'credential', type: 'oauth-input', value: 'c-src' },
    knowledgeBaseId: { id: 'knowledgeBaseId', type: 'knowledge-base-selector', value: 'kb-src' },
    manualCredential: { id: 'manualCredential', type: 'short-input', value: 'mc-src' },
  })

  it('create mode: clears unresolved credentials and remaps copied resources', () => {
    const result = remapForkSubBlocks(
      subBlocks(),
      (kind, id) => (kind === 'knowledge-base' && id === 'kb-src' ? 'kb-dst' : null),
      'create'
    )
    expect(result.subBlocks.credential.value).toBe('')
    expect(result.subBlocks.knowledgeBaseId.value).toBe('kb-dst')
    expect(result.subBlocks.manualCredential.value).toBe('mc-src')
    expect(result.references).toHaveLength(0)
  })

  it('promote mode: keeps + records the basic credential; manual id is escape hatch', () => {
    const result = remapForkSubBlocks(
      subBlocks(),
      (kind, id) => (kind === 'knowledge-base' && id === 'kb-src' ? 'kb-dst' : null),
      'promote'
    )
    // The basic credential is cleared (never carry an invalid cross-workspace id) but
    // still surfaced as required so the sync blocks; the advanced manualCredential is an
    // escape hatch - preserved verbatim, not recorded.
    expect(result.subBlocks.credential.value).toBe('')
    expect(result.subBlocks.manualCredential.value).toBe('mc-src')
    expect(result.subBlocks.knowledgeBaseId.value).toBe('kb-dst')
    const unmappedKinds = result.unmapped.map((r) => `${r.kind}:${r.sourceId}`)
    expect(unmappedKinds).toContain('credential:c-src')
    expect(unmappedKinds).not.toContain('credential:mc-src')
    expect(result.unmapped.every((r) => r.kind !== 'knowledge-base')).toBe(true)
  })

  it('promote mode: preserves a credentialSet ref without flagging it', () => {
    const sb: SubBlockRecord = {
      triggerCredentials: {
        id: 'triggerCredentials',
        type: 'oauth-input',
        value: 'credentialSet:cs-1',
      },
    }
    const result = remapForkSubBlocks(sb, () => null, 'promote')
    expect(result.subBlocks.triggerCredentials.value).toBe('credentialSet:cs-1')
    expect(result.references).toHaveLength(0)
    expect(result.unmapped).toHaveLength(0)
  })

  it('create mode: keeps a credentialSet ref (org-scoped, not cleared)', () => {
    const sb: SubBlockRecord = {
      triggerCredentials: {
        id: 'triggerCredentials',
        type: 'oauth-input',
        value: 'credentialSet:cs-1',
      },
    }
    const result = remapForkSubBlocks(sb, () => null, 'create')
    expect(result.subBlocks.triggerCredentials.value).toBe('credentialSet:cs-1')
    expect(result.references).toHaveLength(0)
  })

  it('promote mode: rewrites {{ENV}} nested in an array-form tool param', () => {
    const sb: SubBlockRecord = {
      tools: {
        id: 'tools',
        type: 'tool-input',
        value: [{ type: 'genericblock', params: { subject: 'Hi {{OLD}}' } }],
      },
    }
    const result = remapForkSubBlocks(
      sb,
      (kind, id) => (kind === 'env-var' && id === 'OLD' ? 'NEW' : null),
      'promote'
    )
    const tools = result.subBlocks.tools.value as Array<{ params: { subject: string } }>
    expect(tools[0].params.subject).toBe('Hi {{NEW}}')
  })
})

const blockWith = (subBlocks: SubBlockConfig[]): BlockConfig =>
  ({ name: 'Test', description: '', subBlocks, outputs: {} }) as unknown as BlockConfig

const entry = (id: string, type: string, value: unknown) => ({ id, type, value })

describe('preserveStableDependents', () => {
  it('restores a dependent whose parent maps to the same target value', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        { id: 'credential', title: 'Credential', type: 'oauth-input' },
        { id: 'folder', title: 'Label', type: 'folder-selector', dependsOn: ['credential'] },
      ])
    )
    const remapped: SubBlockRecord = {
      credential: entry('credential', 'oauth-input', 'cred-target'),
      folder: entry('folder', 'folder-selector', ''),
    }
    const targetCurrent: SubBlockRecord = {
      credential: entry('credential', 'oauth-input', 'cred-target'),
      folder: entry('folder', 'folder-selector', 'INBOX'),
    }
    const result = preserveStableDependents(remapped, 'gmail', targetCurrent)
    expect(result.folder.value).toBe('INBOX')
  })

  it('leaves the dependent cleared when the parent changed', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        { id: 'credential', title: 'Credential', type: 'oauth-input' },
        { id: 'folder', title: 'Label', type: 'folder-selector', dependsOn: ['credential'] },
      ])
    )
    const remapped: SubBlockRecord = {
      credential: entry('credential', 'oauth-input', 'cred-new'),
      folder: entry('folder', 'folder-selector', ''),
    }
    const targetCurrent: SubBlockRecord = {
      credential: entry('credential', 'oauth-input', 'cred-old'),
      folder: entry('folder', 'folder-selector', 'INBOX'),
    }
    const result = preserveStableDependents(remapped, 'gmail', targetCurrent)
    expect(result.folder.value).toBe('')
  })

  it('does nothing when the target has no value to preserve', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        { id: 'credential', title: 'Credential', type: 'oauth-input' },
        { id: 'folder', title: 'Label', type: 'folder-selector', dependsOn: ['credential'] },
      ])
    )
    const remapped: SubBlockRecord = {
      credential: entry('credential', 'oauth-input', 'cred-target'),
      folder: entry('folder', 'folder-selector', ''),
    }
    const targetCurrent: SubBlockRecord = {
      credential: entry('credential', 'oauth-input', 'cred-target'),
      folder: entry('folder', 'folder-selector', ''),
    }
    expect(preserveStableDependents(remapped, 'gmail', targetCurrent)).toBe(remapped)
  })

  it('restores a transitive chain when the root parent is stable', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        { id: 'credential', title: 'Credential', type: 'oauth-input' },
        { id: 'project', title: 'Project', type: 'project-selector', dependsOn: ['credential'] },
        { id: 'issue', title: 'Issue', type: 'project-selector', dependsOn: ['project'] },
      ])
    )
    const remapped: SubBlockRecord = {
      credential: entry('credential', 'oauth-input', 'c-t'),
      project: entry('project', 'project-selector', ''),
      issue: entry('issue', 'project-selector', ''),
    }
    const targetCurrent: SubBlockRecord = {
      credential: entry('credential', 'oauth-input', 'c-t'),
      project: entry('project', 'project-selector', 'P1'),
      issue: entry('issue', 'project-selector', 'I1'),
    }
    const result = preserveStableDependents(remapped, 'jira', targetCurrent)
    expect(result.project.value).toBe('P1')
    expect(result.issue.value).toBe('I1')
  })

  it('preserves a stable dependent nested inside a tool-input tool', () => {
    vi.mocked(getBlock).mockImplementation((type) => {
      if (type === 'agent') return blockWith([{ id: 'tools', title: 'Tools', type: 'tool-input' }])
      if (type === 'gmail')
        return blockWith([
          { id: 'credential', title: 'Credential', type: 'oauth-input' },
          { id: 'folder', title: 'Label', type: 'folder-selector', dependsOn: ['credential'] },
        ])
      return undefined as unknown as BlockConfig
    })
    const remapped: SubBlockRecord = {
      tools: entry('tools', 'tool-input', [
        { type: 'gmail', params: { credential: 'c-t', folder: '' } },
      ]),
    }
    const targetCurrent: SubBlockRecord = {
      tools: entry('tools', 'tool-input', [
        { type: 'gmail', params: { credential: 'c-t', folder: 'INBOX' } },
      ]),
    }
    const result = preserveStableDependents(remapped, 'agent', targetCurrent)
    const tools = result.tools.value as Array<{ params: { folder: string } }>
    expect(tools[0].params.folder).toBe('INBOX')
  })

  it('restores an all/any dependent when the active branch is stable (ignores the unused branch)', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        { id: 'credential', title: 'Credential', type: 'oauth-input' },
        { id: 'spreadsheetId', title: 'Spreadsheet', type: 'file-selector' },
        { id: 'manualSpreadsheetId', title: 'Manual Spreadsheet', type: 'short-input' },
        {
          id: 'sheetName',
          title: 'Sheet',
          type: 'sheet-selector',
          dependsOn: { all: ['credential'], any: ['spreadsheetId', 'manualSpreadsheetId'] },
        },
      ])
    )
    const remapped: SubBlockRecord = {
      credential: entry('credential', 'oauth-input', 'c-t'),
      spreadsheetId: entry('spreadsheetId', 'file-selector', 'ss-1'),
      manualSpreadsheetId: entry('manualSpreadsheetId', 'short-input', ''),
      sheetName: entry('sheetName', 'sheet-selector', ''),
    }
    const targetCurrent: SubBlockRecord = {
      credential: entry('credential', 'oauth-input', 'c-t'),
      spreadsheetId: entry('spreadsheetId', 'file-selector', 'ss-1'),
      manualSpreadsheetId: entry('manualSpreadsheetId', 'short-input', ''),
      sheetName: entry('sheetName', 'sheet-selector', 'Sheet1'),
    }
    const result = preserveStableDependents(remapped, 'google_sheets', targetCurrent)
    expect(result.sheetName.value).toBe('Sheet1')
  })
})

describe('collectClearedDependents', () => {
  it('flags a required dependent the target had set but the merge left empty', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        { id: 'credential', title: 'Credential', type: 'oauth-input' },
        {
          id: 'folder',
          title: 'Label',
          type: 'folder-selector',
          dependsOn: ['credential'],
          required: true,
        },
      ])
    )
    const targetDraft: SubBlockRecord = {
      credential: entry('credential', 'oauth-input', 'c-target'),
      folder: entry('folder', 'folder-selector', 'INBOX'),
    }
    const merged: SubBlockRecord = {
      credential: entry('credential', 'oauth-input', 'c-new'),
      folder: entry('folder', 'folder-selector', ''),
    }
    expect(collectClearedDependents('gmail', 'b1', 'Send Email', targetDraft, merged)).toEqual([
      {
        blockId: 'b1',
        blockName: 'Send Email',
        subBlockKey: 'folder',
        title: 'Label',
        required: true,
      },
    ])
  })

  it('returns an optional cleared dependent flagged required:false', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        { id: 'credential', title: 'Credential', type: 'oauth-input' },
        { id: 'folder', title: 'Label', type: 'folder-selector', dependsOn: ['credential'] },
      ])
    )
    const targetDraft: SubBlockRecord = {
      credential: entry('credential', 'oauth-input', 'c-target'),
      folder: entry('folder', 'folder-selector', 'INBOX'),
    }
    const merged: SubBlockRecord = {
      credential: entry('credential', 'oauth-input', 'c-new'),
      folder: entry('folder', 'folder-selector', ''),
    }
    expect(collectClearedDependents('gmail', 'b1', 'Send Email', targetDraft, merged)).toEqual([
      {
        blockId: 'b1',
        blockName: 'Send Email',
        subBlockKey: 'folder',
        title: 'Label',
        required: false,
      },
    ])
  })

  it('does not flag a dependent the target never configured (only the source carried it)', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        { id: 'credential', title: 'Credential', type: 'oauth-input' },
        { id: 'folder', title: 'Label', type: 'folder-selector', dependsOn: ['credential'] },
      ])
    )
    // The target's fork never set this label, so the merge leaving it empty is not a loss -
    // this is the pull case where the parent carried a filter the fork never had.
    const targetDraft: SubBlockRecord = {
      credential: entry('credential', 'oauth-input', 'c-target'),
      folder: entry('folder', 'folder-selector', ''),
    }
    const merged: SubBlockRecord = {
      credential: entry('credential', 'oauth-input', 'c-new'),
      folder: entry('folder', 'folder-selector', ''),
    }
    expect(collectClearedDependents('gmail', 'b1', 'Send Email', targetDraft, merged)).toEqual([])
  })

  it('does not flag a dependent that ended up with a value (preserved or overridden)', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        { id: 'credential', title: 'Credential', type: 'oauth-input' },
        {
          id: 'folder',
          title: 'Label',
          type: 'folder-selector',
          dependsOn: ['credential'],
          required: true,
        },
      ])
    )
    const targetDraft: SubBlockRecord = {
      credential: entry('credential', 'oauth-input', 'c-target'),
      folder: entry('folder', 'folder-selector', 'INBOX'),
    }
    const merged: SubBlockRecord = {
      credential: entry('credential', 'oauth-input', 'c-target'),
      folder: entry('folder', 'folder-selector', 'INBOX'),
    }
    expect(collectClearedDependents('gmail', 'b1', 'Send Email', targetDraft, merged)).toEqual([])
  })

  it('does not flag a cleared dependent gated off by its condition', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        { id: 'credential', title: 'Credential', type: 'oauth-input' },
        { id: 'operation', title: 'Operation', type: 'dropdown' },
        {
          id: 'folder',
          title: 'Label',
          type: 'folder-selector',
          dependsOn: ['credential'],
          required: true,
          condition: { field: 'operation', value: 'read' },
        },
      ])
    )
    // The operation is 'send', so the read-only folder field is inactive - a stale value
    // it carried must not be flagged as required.
    const targetDraft: SubBlockRecord = {
      credential: entry('credential', 'oauth-input', 'c-target'),
      operation: entry('operation', 'dropdown', 'send'),
      folder: entry('folder', 'folder-selector', 'INBOX'),
    }
    const merged: SubBlockRecord = {
      credential: entry('credential', 'oauth-input', 'c-new'),
      operation: entry('operation', 'dropdown', 'send'),
      folder: entry('folder', 'folder-selector', ''),
    }
    expect(collectClearedDependents('gmail', 'b1', 'Send Email', targetDraft, merged)).toEqual([])
  })

  it('flags a cleared dependent nested inside a tool-input tool', () => {
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
            required: true,
          },
        ])
      return undefined as unknown as BlockConfig
    })
    const targetDraft: SubBlockRecord = {
      tools: entry('tools', 'tool-input', [
        { type: 'gmail', title: 'Gmail', params: { credential: 'c-target', folder: 'INBOX' } },
      ]),
    }
    const merged: SubBlockRecord = {
      tools: entry('tools', 'tool-input', [
        { type: 'gmail', title: 'Gmail', params: { credential: 'c-new', folder: '' } },
      ]),
    }
    expect(collectClearedDependents('agent', 'b1', 'Agent', targetDraft, merged)).toEqual([
      {
        blockId: 'b1',
        blockName: 'Agent',
        subBlockKey: 'tools[0].folder',
        title: 'Gmail: Label',
        required: true,
      },
    ])
  })
})

describe('applyDependentOverrides', () => {
  const gmailConfig = () =>
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

  it('applies a top-level re-pick value', () => {
    vi.mocked(getBlock).mockReturnValue(gmailConfig())
    const subBlocks: SubBlockRecord = {
      credential: entry('credential', 'oauth-input', 'c-new'),
      folder: entry('folder', 'folder-selector', ''),
    }
    const result = applyDependentOverrides(subBlocks, 'gmail', new Map([['folder', 'Label_42']]))
    expect((result.folder as { value: unknown }).value).toBe('Label_42')
  })

  it('rejects an override for a non-dependent / parent key (allowlist)', () => {
    vi.mocked(getBlock).mockReturnValue(gmailConfig())
    const subBlocks: SubBlockRecord = {
      credential: entry('credential', 'oauth-input', 'c-new'),
      folder: entry('folder', 'folder-selector', ''),
    }
    // 'credential' is a parent (no selectorKey) - must never be writable via override.
    const result = applyDependentOverrides(subBlocks, 'gmail', new Map([['credential', 'evil']]))
    expect(result).toBe(subBlocks)
    expect((subBlocks.credential as { value: unknown }).value).toBe('c-new')
  })

  it('applies a nested tool-input re-pick onto the matching tool param', () => {
    vi.mocked(getBlock).mockImplementation((type) => {
      if (type === 'agent') return blockWith([{ id: 'tools', title: 'Tools', type: 'tool-input' }])
      if (type === 'gmail') return gmailConfig()
      return undefined as unknown as BlockConfig
    })
    const subBlocks: SubBlockRecord = {
      tools: entry('tools', 'tool-input', [
        { type: 'gmail', title: 'Gmail', params: { credential: 'c-new', folder: '' } },
      ]),
    }
    const result = applyDependentOverrides(
      subBlocks,
      'agent',
      new Map([['tools[0].folder', 'Label_99']])
    )
    const tools = (result.tools as { value: Array<{ params: { folder: string } }> }).value
    expect(tools[0].params.folder).toBe('Label_99')
  })

  it('rejects a nested override for a non-allowlisted tool param', () => {
    vi.mocked(getBlock).mockImplementation((type) => {
      if (type === 'agent') return blockWith([{ id: 'tools', title: 'Tools', type: 'tool-input' }])
      if (type === 'gmail') return gmailConfig()
      return undefined as unknown as BlockConfig
    })
    const subBlocks: SubBlockRecord = {
      tools: entry('tools', 'tool-input', [
        { type: 'gmail', title: 'Gmail', params: { credential: 'c-new', folder: '' } },
      ]),
    }
    // 'credential' inside the tool is a parent - not overridable.
    const result = applyDependentOverrides(
      subBlocks,
      'agent',
      new Map([['tools[0].credential', 'evil']])
    )
    expect(result).toBe(subBlocks)
  })

  it('ignores a nested override whose tool index is out of range', () => {
    vi.mocked(getBlock).mockImplementation((type) => {
      if (type === 'agent') return blockWith([{ id: 'tools', title: 'Tools', type: 'tool-input' }])
      if (type === 'gmail') return gmailConfig()
      return undefined as unknown as BlockConfig
    })
    const subBlocks: SubBlockRecord = {
      tools: entry('tools', 'tool-input', [
        { type: 'gmail', title: 'Gmail', params: { credential: 'c-new', folder: '' } },
      ]),
    }
    const result = applyDependentOverrides(
      subBlocks,
      'agent',
      new Map([['tools[5].folder', 'Label_99']])
    )
    expect(result).toBe(subBlocks)
  })
})
