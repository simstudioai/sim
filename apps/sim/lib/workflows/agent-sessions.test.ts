import { describe, expect, it, vi } from 'vitest'
import {
  type AgentSessionBlockShape,
  buildAgentSessionCatalog,
  remapCopiedAgentSessions,
  resolveAgentSessionId,
} from '@/lib/workflows/agent-sessions'

function codexBlock(
  id: string,
  agentId: unknown,
  values: Record<string, unknown> = {}
): AgentSessionBlockShape {
  return {
    id,
    type: 'codex',
    name: `Codex ${id}`,
    subBlocks: {
      agentId: { value: agentId },
      mode: { value: values.mode ?? 'cloud_plan' },
      model: { value: values.model ?? 'gpt-5.2-codex' },
      owner: { value: values.owner ?? 'simstudioai' },
      repo: { value: values.repo ?? 'sim' },
      baseBranch: { value: values.baseBranch ?? null },
    },
  }
}

describe('agent session catalog', () => {
  it('groups legacy IDs and labels logical agents without exposing their IDs', () => {
    const blocks = {
      first: codexBlock('first', ''),
      second: codexBlock('second', 'first'),
      third: codexBlock('third', 'shared-agent'),
      fourth: codexBlock('fourth', 'shared-agent'),
    }

    const sessions = buildAgentSessionCatalog({
      blocks,
      blockType: 'codex',
      sessionSubBlockId: 'agentId',
      compatibleSubBlockIds: ['mode', 'model', 'owner', 'repo', 'baseBranch'],
    })

    expect(sessions.map(({ label, blockIds }) => ({ label, blockIds }))).toEqual([
      { label: 'Agent 1', blockIds: ['first', 'second'] },
      { label: 'Agent 2', blockIds: ['third', 'fourth'] },
    ])
    expect(sessions[0].color).toBe(sessions.find((session) => session.id === 'first')?.color)
    expect(sessions.map((session) => session.label)).not.toContain('shared-agent')
  })

  it('uses live values, including an explicit null, for inherited configuration', () => {
    const sessions = buildAgentSessionCatalog({
      blocks: { first: codexBlock('first', '', { baseBranch: 'main' }) },
      subBlockValues: {
        first: { model: 'gpt-5.3-codex', baseBranch: null },
      },
      blockType: 'codex',
      sessionSubBlockId: 'agentId',
      compatibleSubBlockIds: ['model', 'baseBranch'],
    })

    expect(sessions[0].values).toEqual({ model: 'gpt-5.3-codex', baseBranch: null })
    expect(resolveAgentSessionId('first', null)).toBe('first')
  })
})

describe('copied agent session remapping', () => {
  it('keeps a copied default agent blank so its new block ID makes it independent', () => {
    const source = codexBlock('old', '')
    const copied = structuredClone(source)
    copied.id = 'new'
    const copiedValues = { new: { agentId: '' } }
    const createId = vi.fn(() => 'unused')

    remapCopiedAgentSessions({
      sourceBlocks: { old: source },
      copiedBlocks: { new: copied },
      blockIdMap: new Map([['old', 'new']]),
      copiedSubBlockValues: copiedValues,
      createId,
    })

    expect(copied.subBlocks.agentId.value).toBe('')
    expect(copiedValues.new.agentId).toBe('')
    expect(createId).not.toHaveBeenCalled()
  })

  it('gives an explicitly identified agent a fresh hidden ID', () => {
    const source = codexBlock('old', 'shared-agent')
    const copied = structuredClone(source)
    copied.id = 'new'
    const copiedValues = { new: { agentId: 'shared-agent' } }

    remapCopiedAgentSessions({
      sourceBlocks: { old: source },
      copiedBlocks: { new: copied },
      blockIdMap: new Map([['old', 'new']]),
      copiedSubBlockValues: copiedValues,
      createId: () => 'fresh-agent',
    })

    expect(copied.subBlocks.agentId.value).toBe('fresh-agent')
    expect(copiedValues.new.agentId).toBe('fresh-agent')
  })

  it('preserves sharing inside a batch without sharing with the originals', () => {
    const sourceA = codexBlock('old-a', 'shared-agent')
    const sourceB = codexBlock('old-b', 'shared-agent')
    const copyA = structuredClone(sourceA)
    const copyB = structuredClone(sourceB)
    copyA.id = 'new-a'
    copyB.id = 'new-b'
    const copiedValues = {
      'new-a': { agentId: 'shared-agent' },
      'new-b': { agentId: 'shared-agent' },
    }
    const createId = vi.fn(() => 'fresh-agent')

    remapCopiedAgentSessions({
      sourceBlocks: { 'old-a': sourceA, 'old-b': sourceB },
      copiedBlocks: { 'new-a': copyA, 'new-b': copyB },
      blockIdMap: new Map([
        ['old-a', 'new-a'],
        ['old-b', 'new-b'],
      ]),
      copiedSubBlockValues: copiedValues,
      createId,
    })

    expect(copyA.subBlocks.agentId.value).toBe('fresh-agent')
    expect(copyB.subBlocks.agentId.value).toBe('fresh-agent')
    expect(createId).toHaveBeenCalledTimes(1)
  })

  it('uses the copied default owner as the identity for a mixed shared group', () => {
    const sourceA = codexBlock('old-a', '')
    const sourceB = codexBlock('old-b', 'old-a')
    const copyA = structuredClone(sourceA)
    const copyB = structuredClone(sourceB)
    copyA.id = 'new-a'
    copyB.id = 'new-b'
    const copiedValues = {
      'new-a': { agentId: '' },
      'new-b': { agentId: 'old-a' },
    }

    remapCopiedAgentSessions({
      sourceBlocks: { 'old-a': sourceA, 'old-b': sourceB },
      copiedBlocks: { 'new-a': copyA, 'new-b': copyB },
      blockIdMap: new Map([
        ['old-a', 'new-a'],
        ['old-b', 'new-b'],
      ]),
      copiedSubBlockValues: copiedValues,
      createId: () => 'unused',
    })

    expect(copyA.subBlocks.agentId.value).toBe('')
    expect(copyB.subBlocks.agentId.value).toBe('new-a')
    expect(copiedValues['new-b'].agentId).toBe('new-a')
  })
})
