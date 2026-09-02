import { describe, expect, it } from 'vitest'
import {
  MAX_SEARCHED_KNOWLEDGE_BASES,
  searchedKnowledgeBases,
  withSearchedKnowledgeContexts,
} from '@/lib/sim-search/knowledge-bases'

const base = (id: string, workspaceId: string | null = 'ws-1') => ({
  id,
  name: `Base ${id}`,
  workspaceId,
})

describe('searchedKnowledgeBases', () => {
  it('keeps only the bases of the named workspace, capped', () => {
    const bases = [
      base('legacy', null),
      base('other', 'ws-2'),
      ...Array.from({ length: MAX_SEARCHED_KNOWLEDGE_BASES + 1 }, (_, i) => base(`kb-${i}`)),
    ]
    const searched = searchedKnowledgeBases(bases, 'ws-1')
    expect(searched).toHaveLength(MAX_SEARCHED_KNOWLEDGE_BASES)
    expect(searched.every((kb) => kb.workspaceId === 'ws-1')).toBe(true)
  })
})

describe('withSearchedKnowledgeContexts', () => {
  it('attaches every searched base after the contexts the person chose', () => {
    expect(
      withSearchedKnowledgeContexts(
        [{ kind: 'file', fileId: 'f-1', label: 'notes.md' }],
        [base('kb-1')]
      )
    ).toEqual([
      { kind: 'file', fileId: 'f-1', label: 'notes.md' },
      { kind: 'knowledge', knowledgeId: 'kb-1', label: 'Base kb-1' },
    ])
  })

  it('does not attach a base the person already mentioned', () => {
    const mentioned = { kind: 'knowledge' as const, knowledgeId: 'kb-1', label: 'Mine' }
    expect(withSearchedKnowledgeContexts([mentioned], [base('kb-1'), base('kb-2')])).toEqual([
      mentioned,
      { kind: 'knowledge', knowledgeId: 'kb-2', label: 'Base kb-2' },
    ])
  })

  it('returns the bases alone when nothing was chosen', () => {
    expect(withSearchedKnowledgeContexts(undefined, [base('kb-1')])).toEqual([
      { kind: 'knowledge', knowledgeId: 'kb-1', label: 'Base kb-1' },
    ])
  })
})
