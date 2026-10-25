import { describe, expect, it } from 'vitest'
import type { LinkedPost } from '@/lib/content/links'
import { buildPostLinkIndex, extractInternalLinkPaths } from '@/lib/content/links'
import type { ContentMeta } from '@/lib/content/schema'

function post(
  slug: string,
  date: string,
  tags: string[],
  linkedPaths: string[] = [],
  title = slug
): LinkedPost {
  const meta = { slug, title, date, tags } as ContentMeta
  return { meta, linkedPaths }
}

describe('extractInternalLinkPaths', () => {
  it('normalizes relative and absolute site links and skips external ones', () => {
    const body = [
      'See [one](/library/one) and [two](https://www.sim.ai/library/two#faq).',
      'Also [three](/library/three/) and <a href="/comparisons/n8n?ref=x">n8n</a>.',
      'Not [external](https://example.com/library/four).',
    ].join('\n')

    expect(extractInternalLinkPaths(body).sort()).toEqual([
      '/comparisons/n8n',
      '/library/one',
      '/library/three',
      '/library/two',
    ])
  })
})

describe('buildPostLinkIndex', () => {
  it('ranks a rare shared tag above several tags most posts carry', () => {
    const shared = ['Sim', 'AI Agents', 'Automation']
    const { related } = buildPostLinkIndex(
      [
        post('newest-unrelated', '2026-10-01', shared),
        post('current', '2026-09-01', [...shared, 'Zapier']),
        post('older-on-topic', '2026-01-01', ['Sim', 'Zapier']),
        post('other-a', '2026-02-01', shared),
        post('other-b', '2026-03-01', shared),
      ],
      '/library'
    )

    expect(related.get('current')?.[0].slug).toBe('older-on-topic')
  })

  it('indexes who links to each post, newest first, without self-links', () => {
    const { inbound } = buildPostLinkIndex(
      [
        post('target', '2026-01-01', [], ['/library/target']),
        post('old-citer', '2026-02-01', [], ['/library/target']),
        post('new-citer', '2026-05-01', [], ['/library/target', '/comparisons/n8n']),
      ],
      '/library'
    )

    expect(inbound.get('/library/target')?.map((p) => p.slug)).toEqual(['new-citer', 'old-citer'])
    expect(inbound.get('/comparisons/n8n')?.map((p) => p.slug)).toEqual(['new-citer'])
  })
})
