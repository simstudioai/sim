import { describe, expect, it } from 'vitest'
import type { ContentMeta } from '@/lib/content/schema'
import { getComparisonsForPost } from '@/app/(landing)/comparisons/library-links'

function post(title: string, description: string, tags: string[] = []): ContentMeta {
  return { slug: 'post', title, description, tags } as ContentMeta
}

describe('getComparisonsForPost', () => {
  it('ranks a bare common-word competitor first when the title names its alternatives', () => {
    const [first] = getComparisonsForPost(
      post('Best Make Alternatives for AI Agents', 'How Zapier and n8n compare for AI agents.'),
      new Set()
    )
    expect(first?.name).toBe('Make')
  })

  it('does not read the bare common word elsewhere in a title as that competitor', () => {
    const comparisons = getComparisonsForPost(
      post('How to Make and Ship AI Agent Alternatives', 'A guide to building AI agents.'),
      new Set()
    )
    expect(comparisons.map(({ name }) => name)).not.toContain('Make')
  })
})
