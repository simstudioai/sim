/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import type { ContentMeta } from '@/lib/content/schema'
import sitemap from '@/app/sitemap'

const { getLibraryPosts } = vi.hoisted(() => ({ getLibraryPosts: vi.fn() }))

vi.mock('@/lib/blog/registry', () => ({ getAllPostMeta: async () => [] }))
vi.mock('@/lib/library/registry', () => ({ getAllPostMeta: getLibraryPosts }))
vi.mock('@/lib/customers/registry', () => ({ getAllCustomerStoryMeta: async () => [] }))
vi.mock('@/lib/core/utils/urls', () => ({ SITE_URL: 'https://example.com' }))

function post(slug: string, updated: string): ContentMeta {
  const author = { id: 'sim', name: 'Sim' }
  return {
    slug,
    title: slug,
    description: 'A library article',
    date: '2026-01-01',
    updated,
    author,
    authors: [author],
    tags: [],
    ogImage: '/cover.png',
    canonical: 'https://example.com/library/canonical-article',
    draft: false,
    featured: false,
    technical: false,
  }
}

describe('sitemap canonical URLs', () => {
  it.each([false, true])(
    'emits one entry with the latest modification date (reversed=%s)',
    async (reverse) => {
      const posts = [post('original', '2026-01-02'), post('alias', '2026-02-03')]
      getLibraryPosts.mockResolvedValue(reverse ? posts.reverse() : posts)

      const pages = await sitemap()

      expect(new Set(pages.map((page) => page.url)).size).toBe(pages.length)
      expect(pages.filter((page) => page.url === posts[0].canonical)).toEqual([
        { url: posts[0].canonical, lastModified: new Date('2026-02-03') },
      ])
      expect(pages).toContainEqual({ url: 'https://example.com/workflows' })
      expect(pages).toContainEqual({
        url: 'https://example.com/library/authors/sim',
        lastModified: new Date('2026-02-03'),
      })
    }
  )
})
