/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearDependentToolParams } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tool-input/param-dependents'
import { getBlock } from '@/blocks/registry'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'

const blockWith = (subBlocks: SubBlockConfig[]): BlockConfig =>
  ({ name: 'Tool', description: '', subBlocks, outputs: {} }) as unknown as BlockConfig

describe('clearDependentToolParams', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('clears a non-empty dependent when its parent changes', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        { id: 'credential', title: 'Credential', type: 'oauth-input' },
        { id: 'folder', title: 'Label', type: 'folder-selector', dependsOn: ['credential'] },
      ])
    )
    const result = clearDependentToolParams(
      'gmail',
      { credential: 'cred-2', folder: 'INBOX' },
      'credential'
    )
    expect(result.folder).toBe('')
    // The changed param itself is untouched.
    expect(result.credential).toBe('cred-2')
  })

  it('clears transitively (a grandchild dependent is also cleared)', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        { id: 'credential', title: 'Credential', type: 'oauth-input' },
        { id: 'folder', title: 'Label', type: 'folder-selector', dependsOn: ['credential'] },
        { id: 'thread', title: 'Thread', type: 'short-input', dependsOn: ['folder'] },
      ])
    )
    const result = clearDependentToolParams(
      'gmail',
      { credential: 'cred-2', folder: 'INBOX', thread: 't-1' },
      'credential'
    )
    expect(result.folder).toBe('')
    expect(result.thread).toBe('')
  })

  it('clears a dependent when a canonical-pair member changes (advanced member, dependent on the canonical id)', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
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
        { id: 'folder', title: 'Label', type: 'folder-selector', dependsOn: ['credential'] },
      ])
    )
    const result = clearDependentToolParams(
      'gmail',
      { manualCredential: 'mc-2', folder: 'INBOX' },
      'manualCredential'
    )
    // The shared walk expands the canonical group, so an advanced-member change clears the dependent.
    expect(result.folder).toBe('')
  })

  it('leaves an already-empty dependent and a non-dependent param untouched (same reference)', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        { id: 'credential', title: 'Credential', type: 'oauth-input' },
        { id: 'folder', title: 'Label', type: 'folder-selector', dependsOn: ['credential'] },
        { id: 'subject', title: 'Subject', type: 'short-input' },
      ])
    )
    const params = { credential: 'cred-2', folder: '', subject: 'keep' }
    const result = clearDependentToolParams('gmail', params, 'credential')
    // The only dependent is already empty, so nothing changes - the same reference is returned.
    expect(result).toBe(params)
    expect(result.subject).toBe('keep')
  })

  it('returns equivalent params when the changed param has no dependents', () => {
    vi.mocked(getBlock).mockReturnValue(
      blockWith([
        { id: 'credential', title: 'Credential', type: 'oauth-input' },
        { id: 'subject', title: 'Subject', type: 'short-input' },
      ])
    )
    const params = { credential: 'cred-2', subject: 'hello' }
    const result = clearDependentToolParams('gmail', params, 'subject')
    expect(result).toBe(params)
  })
})
