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
import { createForkBootstrapTransform } from '@/lib/workspaces/fork/remap/fork-bootstrap'
import {
  applyDependentOverrides,
  clearDependentsOnRemap,
  collectClearedDependents,
  parseNestedDependentKey,
  readTargetDraftDependentValue,
  remapForkSubBlocks,
  remapToolBlockResources,
  scanWorkflowReferences,
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

  it('remaps a nested documentId through the doc map when its document was copied', () => {
    const tool = {
      type: 'depblock',
      toolId: 'depblock_run',
      params: { knowledgeBaseId: 'kb-src', documentId: 'doc-src' },
    }
    const map: Record<string, string> = {
      'knowledge-base:kb-src': 'kb-dst',
      'knowledge-document:doc-src': 'doc-dst',
    }
    const result = remapToolBlockResources(tool, {
      resolve: (kind, id) => map[`${kind}:${id}`] ?? null,
      resolveFileKey: () => null,
      clearUnresolved: true,
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
    // documentId is remapped (not cleared as a dependent) because its document was copied.
    expect(result.params).toEqual({ knowledgeBaseId: 'kb-dst', documentId: 'doc-dst' })
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

  const fileSubBlock = (): SubBlockRecord => ({
    file: {
      id: 'file',
      type: 'file-upload',
      value: { key: 'workspace/SRC/a.png', name: 'a.png' },
    },
  })

  it('promote mode: records an unmapped file-upload key as a file reference and clears it', () => {
    const result = remapForkSubBlocks(fileSubBlock(), () => null, 'promote')
    const keys = result.references.map((r) => `${r.kind}:${r.sourceId}`)
    expect(keys).toContain('file:workspace/SRC/a.png')
    // file refs are optional (not required), surfaced for the copy/clear decision.
    expect(result.references.find((r) => r.kind === 'file')?.required).toBe(false)
    expect(result.unmapped.map((r) => `${r.kind}:${r.sourceId}`)).toContain(
      'file:workspace/SRC/a.png'
    )
    // An uncopied file key is dropped rather than carried cross-workspace.
    expect(result.subBlocks.file.value).toBe('')
  })

  it('promote mode: remaps a file-upload key to the copied target and records it mapped', () => {
    const result = remapForkSubBlocks(
      fileSubBlock(),
      (kind, id) =>
        kind === 'file' && id === 'workspace/SRC/a.png' ? 'workspace/DST/a.png' : null,
      'promote'
    )
    expect(result.references.map((r) => `${r.kind}:${r.sourceId}`)).toContain(
      'file:workspace/SRC/a.png'
    )
    expect(result.unmapped).toHaveLength(0)
    expect((result.subBlocks.file.value as { key: string }).key).toBe('workspace/DST/a.png')
  })

  it('create mode: does not record file references but still remaps copied files', () => {
    const result = remapForkSubBlocks(
      fileSubBlock(),
      (kind, id) =>
        kind === 'file' && id === 'workspace/SRC/a.png' ? 'workspace/DST/a.png' : null,
      'create'
    )
    expect(result.references).toHaveLength(0)
    expect((result.subBlocks.file.value as { key: string }).key).toBe('workspace/DST/a.png')
  })
})

const blockWith = (subBlocks: SubBlockConfig[]): BlockConfig =>
  ({ name: 'Test', description: '', subBlocks, outputs: {} }) as unknown as BlockConfig

const entry = (id: string, type: string, value: unknown) => ({ id, type, value })

describe('createForkBootstrapTransform document-selector remap', () => {
  const docBlock = () =>
    blockWith([
      { id: 'knowledgeBaseId', title: 'KB', type: 'knowledge-base-selector' },
      { id: 'documentId', title: 'Doc', type: 'document-selector', dependsOn: ['knowledgeBaseId'] },
    ])
  const subBlocks = (): SubBlockRecord => ({
    knowledgeBaseId: { id: 'knowledgeBaseId', type: 'knowledge-base-selector', value: 'kb-src' },
    documentId: { id: 'documentId', type: 'document-selector', value: 'doc-src' },
  })

  it('remaps documentId to the copied document (not cleared as a KB dependent)', () => {
    vi.mocked(getBlock).mockReturnValue(docBlock())
    const map: Record<string, string> = {
      'knowledge-base:kb-src': 'kb-dst',
      'knowledge-document:doc-src': 'doc-dst',
    }
    const transform = createForkBootstrapTransform((kind, id) => map[`${kind}:${id}`] ?? null)
    const result = transform(subBlocks(), 'knowledge')
    expect(result.knowledgeBaseId.value).toBe('kb-dst')
    expect(result.documentId.value).toBe('doc-dst')
  })

  it('clears documentId when its parent KB was not copied', () => {
    vi.mocked(getBlock).mockReturnValue(docBlock())
    const transform = createForkBootstrapTransform(() => null)
    const result = transform(subBlocks(), 'knowledge')
    expect(result.knowledgeBaseId.value).toBe('')
    expect(result.documentId.value).toBe('')
  })

  it('clears documentId when its KB was copied but the document was not', () => {
    vi.mocked(getBlock).mockReturnValue(docBlock())
    const transform = createForkBootstrapTransform((kind, id) =>
      kind === 'knowledge-base' && id === 'kb-src' ? 'kb-dst' : null
    )
    const result = transform(subBlocks(), 'knowledge')
    expect(result.knowledgeBaseId.value).toBe('kb-dst')
    expect(result.documentId.value).toBe('')
  })
})

describe('clearDependentsOnRemap canonical-pair gating', () => {
  const kbCanonicalBlock = () =>
    blockWith([
      {
        id: 'knowledgeBaseSelector',
        title: 'KB',
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
        dependsOn: ['knowledgeBaseSelector'],
      },
    ])

  it('does not clear a dependent when only the DORMANT basic selector was remapped (advanced active)', () => {
    vi.mocked(getBlock).mockReturnValue(kbCanonicalBlock())
    const subBlocks: SubBlockRecord = {
      knowledgeBaseSelector: { type: 'knowledge-base-selector', value: '' },
      manualKnowledgeBaseId: { type: 'short-input', value: 'kb-active' },
      documentSelector: { type: 'document-selector', value: 'doc-1' },
    }
    const result = clearDependentsOnRemap(
      subBlocks,
      'knowledge',
      new Set(['knowledgeBaseSelector']),
      {
        knowledgeBaseId: 'advanced',
      }
    )
    // The active advanced parent is unchanged, so the dependent must be preserved.
    expect(result.documentSelector.value).toBe('doc-1')
  })

  it('clears a dependent when the ACTIVE basic selector was remapped (basic active)', () => {
    vi.mocked(getBlock).mockReturnValue(kbCanonicalBlock())
    const subBlocks: SubBlockRecord = {
      knowledgeBaseSelector: { type: 'knowledge-base-selector', value: 'kb-new' },
      manualKnowledgeBaseId: { type: 'short-input', value: '' },
      documentSelector: { type: 'document-selector', value: 'doc-1' },
    }
    const result = clearDependentsOnRemap(
      subBlocks,
      'knowledge',
      new Set(['knowledgeBaseSelector']),
      {
        knowledgeBaseId: 'basic',
      }
    )
    // Basic is active; its remap clears the dependent (unchanged behavior).
    expect(result.documentSelector.value).toBe('')
  })
})

describe('scanWorkflowReferences canonical-pair detection', () => {
  const credBlock = () =>
    blockWith([
      {
        id: 'credential',
        title: 'Account',
        type: 'oauth-input',
        canonicalParamId: 'credential',
        mode: 'basic',
      },
      {
        id: 'manualCredential',
        title: 'Account ID',
        type: 'short-input',
        canonicalParamId: 'credential',
        mode: 'advanced',
      },
    ])
  // The advanced manualCredential is a short-input escape hatch (never scanned); the basic
  // oauth-input is the detectable member, so the "active" assertion targets the basic mode.
  const scanBlock = (canonicalModes?: Record<string, 'basic' | 'advanced'>) => ({
    id: 'b1',
    name: 'Send',
    type: 'gmail',
    canonicalModes,
    subBlocks: {
      credential: { id: 'credential', type: 'oauth-input', value: 'cred-stale' },
      manualCredential: { id: 'manualCredential', type: 'short-input', value: 'cred-active' },
    },
  })

  it('does not detect a DORMANT basic credential while advanced is active (no required ref / sync gate)', () => {
    vi.mocked(getBlock).mockReturnValue(credBlock())
    const scan = scanWorkflowReferences([scanBlock({ credential: 'advanced' })], () => null)
    expect(scan.references.filter((ref) => ref.kind === 'credential')).toEqual([])
    expect(scan.unmapped.filter((ref) => ref.kind === 'credential')).toEqual([])
  })

  it('detects the ACTIVE basic credential as a required reference (basic active)', () => {
    vi.mocked(getBlock).mockReturnValue(credBlock())
    const scan = scanWorkflowReferences([scanBlock({ credential: 'basic' })], () => null)
    const creds = scan.references.filter((ref) => ref.kind === 'credential')
    expect(creds).toHaveLength(1)
    expect(creds[0].sourceId).toBe('cred-stale')
    expect(creds[0].required).toBe(true)
  })

  it('skips DETECTION for a dormant member but still REWRITES its value (separation)', () => {
    vi.mocked(getBlock).mockReturnValue(credBlock())
    const result = remapForkSubBlocks(
      {
        credential: { id: 'credential', type: 'oauth-input', value: 'cred-stale' },
        manualCredential: { id: 'manualCredential', type: 'short-input', value: 'cred-active' },
      },
      () => null,
      'promote',
      { blockType: 'gmail', canonicalModes: { credential: 'advanced' } }
    )
    // Detection skipped (dormant basic), so it never gates sync...
    expect(result.references.filter((ref) => ref.kind === 'credential')).toEqual([])
    // ...but the dual-mode rewrite still cleared the unresolved dormant basic credential.
    expect(result.subBlocks.credential.value).toBe('')
    // The advanced escape-hatch id is preserved verbatim (not auto-remapped).
    expect(result.subBlocks.manualCredential.value).toBe('cred-active')
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

describe('parseNestedDependentKey', () => {
  it('parses a nested tool-input key with a numeric index', () => {
    expect(parseNestedDependentKey('tools[0].folder')).toEqual({
      toolInputId: 'tools',
      index: 0,
      paramId: 'folder',
    })
    expect(parseNestedDependentKey('tools[12].channel')).toEqual({
      toolInputId: 'tools',
      index: 12,
      paramId: 'channel',
    })
  })

  it('returns null for a plain top-level key', () => {
    expect(parseNestedDependentKey('folder')).toBeNull()
    expect(parseNestedDependentKey('credential')).toBeNull()
  })
})

describe('readTargetDraftDependentValue', () => {
  it('reads a top-level draft value', () => {
    const draft: SubBlockRecord = { folder: { value: 'INBOX' } }
    expect(readTargetDraftDependentValue(draft, undefined, 'folder')).toBe('INBOX')
  })

  it('returns empty for a missing or non-string top-level value', () => {
    expect(readTargetDraftDependentValue({ folder: { value: 42 } }, undefined, 'folder')).toBe('')
    expect(readTargetDraftDependentValue({}, undefined, 'folder')).toBe('')
    expect(readTargetDraftDependentValue(undefined, undefined, 'folder')).toBe('')
  })

  it('reads the target draft nested param when the source/target tool types match at that index', () => {
    const target: SubBlockRecord = {
      tools: { value: [{ type: 'gmail', params: { folder: 'INBOX' } }] },
    }
    const source: SubBlockRecord = {
      tools: { value: [{ type: 'gmail', params: { folder: 'SENT' } }] },
    }
    // Reads the TARGET draft's value (INBOX), gated on a same-type tool at the index.
    expect(readTargetDraftDependentValue(target, source, 'tools[0].folder')).toBe('INBOX')
  })

  it('identity guard: returns empty when the target draft tool type differs from the source dependent tool', () => {
    // The source dependent hangs off a Gmail tool at index 0, but the target draft holds a Slack
    // tool there - its param value is not this field's value, so nothing is seeded.
    const target: SubBlockRecord = {
      tools: { value: [{ type: 'slack', params: { folder: 'INBOX' } }] },
    }
    const source: SubBlockRecord = {
      tools: { value: [{ type: 'gmail', params: { folder: 'SENT' } }] },
    }
    expect(readTargetDraftDependentValue(target, source, 'tools[0].folder')).toBe('')
  })

  it('returns empty when the target draft has no tool at the index', () => {
    const target: SubBlockRecord = { tools: { value: [] } }
    const source: SubBlockRecord = {
      tools: { value: [{ type: 'gmail', params: { folder: 'SENT' } }] },
    }
    expect(readTargetDraftDependentValue(target, source, 'tools[0].folder')).toBe('')
  })

  it('returns empty when the source tool type cannot be verified', () => {
    const target: SubBlockRecord = {
      tools: { value: [{ type: 'gmail', params: { folder: 'INBOX' } }] },
    }
    // No source subBlocks (or no tool at the index) -> identity unverifiable -> do not seed.
    expect(readTargetDraftDependentValue(target, undefined, 'tools[0].folder')).toBe('')
    expect(readTargetDraftDependentValue(target, { tools: { value: [] } }, 'tools[0].folder')).toBe(
      ''
    )
  })

  it('handles the JSON-string stored tool array shape', () => {
    const target: SubBlockRecord = {
      tools: { value: JSON.stringify([{ type: 'gmail', params: { folder: 'INBOX' } }]) },
    }
    const source: SubBlockRecord = {
      tools: { value: JSON.stringify([{ type: 'gmail', params: { folder: 'SENT' } }]) },
    }
    expect(readTargetDraftDependentValue(target, source, 'tools[0].folder')).toBe('INBOX')
  })
})
