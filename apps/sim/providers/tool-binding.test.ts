/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { SubBlockConfig } from '@/blocks/types'
import {
  collectToolResourceBindings,
  getProviderToolBindings,
  groupDuplicateToolsByCanonicalId,
  registerProviderToolBindings,
} from '@/providers/tool-binding'
import { assignProviderToolIdentities } from '@/providers/tool-identity'
import type { ProviderToolConfig } from '@/providers/types'

function providerTool(id: string): ProviderToolConfig {
  return {
    id,
    description: id,
    params: {},
    parameters: { type: 'object', properties: {}, required: [] },
  }
}

const oauthPair: SubBlockConfig[] = [
  {
    id: 'credential',
    title: 'Gmail Account',
    type: 'oauth-input',
    canonicalParamId: 'oauthCredential',
  } as SubBlockConfig,
  {
    id: 'manualCredential',
    title: 'Gmail Account',
    type: 'short-input',
    canonicalParamId: 'oauthCredential',
  } as SubBlockConfig,
]

describe('groupDuplicateToolsByCanonicalId', () => {
  it('returns only groups with a duplicate', () => {
    const first = providerTool('gmail_read_email')
    const second = providerTool('gmail_read_email')
    const unique = providerTool('slack_send_message')

    const groups = groupDuplicateToolsByCanonicalId([first, second, unique])

    expect(groups).toHaveLength(1)
    expect(groups[0]).toEqual([first, second])
  })

  it('groups identically before and after provider aliasing', () => {
    const tools = [providerTool('gmail_read_email'), providerTool('gmail_read_email')]
    const before = groupDuplicateToolsByCanonicalId(tools)

    assignProviderToolIdentities(tools)

    expect(tools[1].id).toBe('gmail_read_email__sim_2')
    expect(groupDuplicateToolsByCanonicalId(tools)).toEqual(before)
  })

  it('returns references, never copies', () => {
    const first = providerTool('gmail_read_email')
    const second = providerTool('gmail_read_email')

    const [group] = groupDuplicateToolsByCanonicalId([first, second])

    expect(group[0]).toBe(first)
    expect(group[1]).toBe(second)
  })
})

describe('provider tool binding registration', () => {
  it('round-trips on the exact object and misses a structural twin', () => {
    const tool = providerTool('gmail_read_email')
    const binding = { kind: 'credential' as const, id: 'cred-a', fieldTitle: 'Gmail Account' }
    registerProviderToolBindings(tool, [binding])

    expect(getProviderToolBindings(tool)).toEqual([binding])
    expect(getProviderToolBindings({ ...tool })).toBeUndefined()
  })

  it('stores nothing for an empty binding list', () => {
    const tool = providerTool('gmail_read_email')
    registerProviderToolBindings(tool, [])
    expect(getProviderToolBindings(tool)).toBeUndefined()
  })
})

describe('collectToolResourceBindings', () => {
  it('collapses a canonical basic/advanced pair into one binding', () => {
    const bindings = collectToolResourceBindings({
      subBlocks: oauthPair,
      userProvidedParams: { credential: 'cred-a' },
      resolvedResourceParams: { oauthCredential: 'cred-a' },
    })

    expect(bindings).toEqual([{ kind: 'credential', id: 'cred-a', fieldTitle: 'Gmail Account' }])
  })

  it('reads the resolved canonical value rather than the raw basic subblock', () => {
    const bindings = collectToolResourceBindings({
      subBlocks: oauthPair,
      userProvidedParams: { credential: 'cred-basic', manualCredential: 'cred-advanced' },
      resolvedResourceParams: { oauthCredential: 'cred-advanced' },
    })

    expect(bindings[0].id).toBe('cred-advanced')
  })

  it('binds an oauth-input that declares no canonicalParamId', () => {
    const bindings = collectToolResourceBindings({
      subBlocks: [
        { id: 'credential', title: 'Box Account', type: 'oauth-input' } as SubBlockConfig,
      ],
      userProvidedParams: { credential: 'cred-box' },
      resolvedResourceParams: {},
    })

    expect(bindings).toEqual([{ kind: 'credential', id: 'cred-box', fieldTitle: 'Box Account' }])
  })

  it('ignores selectors that name a third-party resource', () => {
    const bindings = collectToolResourceBindings({
      subBlocks: [
        { id: 'fileId', title: 'File', type: 'file-selector' } as SubBlockConfig,
        { id: 'channel', title: 'Channel', type: 'channel-selector' } as SubBlockConfig,
      ],
      userProvidedParams: { fileId: 'file-1', channel: 'C123' },
      resolvedResourceParams: {},
    })

    expect(bindings).toEqual([])
  })

  it('rejects a value that is not a plain resource id', () => {
    const bindings = collectToolResourceBindings({
      subBlocks: oauthPair,
      userProvidedParams: {},
      resolvedResourceParams: { oauthCredential: '{{GMAIL_CREDENTIAL}}' },
    })

    expect(bindings).toEqual([])
  })

  it('marks the binding a self-describing enrichment already named', () => {
    const bindings = collectToolResourceBindings({
      subBlocks: [
        {
          id: 'knowledgeBaseId',
          title: 'Knowledge Base',
          type: 'knowledge-base-selector',
        } as SubBlockConfig,
      ],
      userProvidedParams: { knowledgeBaseId: 'kb-a' },
      resolvedResourceParams: {},
      selfDescribedParamId: 'knowledgeBaseId',
    })

    expect(bindings[0].selfDescribed).toBe(true)
  })

  it('carries a preresolved workflow label', () => {
    const bindings = collectToolResourceBindings({
      subBlocks: [
        { id: 'workflowId', title: 'Workflow', type: 'workflow-selector' } as SubBlockConfig,
      ],
      userProvidedParams: { workflowId: 'wf-a' },
      resolvedResourceParams: {},
      workflowLabel: 'Refund Flow',
    })

    expect(bindings[0].preresolvedLabel).toBe('Refund Flow')
  })
})
