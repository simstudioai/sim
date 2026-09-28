import { describe, expect, it, vi } from 'vitest'
import { computeMentionRanges } from '@/app/workspace/[workspaceId]/home/components/user-message-content/utils'
import type { ChatMessageContext } from '@/app/workspace/[workspaceId]/home/types'

vi.mock('@/blocks/integration-matcher', () => ({
  getIntegrationMatcher: () => ({ regex: null, byName: new Map() }),
}))

function spans(text: string, contexts: ChatMessageContext[]): string[] {
  return computeMentionRanges(text, contexts).map((range) => text.slice(range.start, range.end))
}

describe('computeMentionRanges', () => {
  const workflow: ChatMessageContext = { kind: 'workflow', label: 'Workflow' }

  it('matches a mention followed by punctuation', () => {
    expect(spans('Run @Workflow, then stop.', [workflow])).toEqual(['@Workflow'])
    expect(spans('(see @Workflow)', [workflow])).toEqual(['@Workflow'])
  })

  it('matches every repeat of a mention separated by one space', () => {
    expect(spans('@Workflow @Workflow', [workflow])).toEqual(['@Workflow', '@Workflow'])
  })

  it('does not match a mention that is a prefix of a longer name', () => {
    expect(spans('@Workflow-2', [workflow])).toEqual([])
  })

  it('matches slash commands by their slash prefix', () => {
    expect(spans('/research the topic', [{ kind: 'slash_command', label: 'research' }])).toEqual([
      '/research',
    ])
  })
})
