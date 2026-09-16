/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContentPost } from '@/lib/content/schema'

const { getPostBySlug } = vi.hoisted(() => ({
  getPostBySlug: vi.fn<(slug: string) => Promise<ContentPost | null>>(),
}))

vi.mock('@/lib/blog/registry', () => ({
  getPostBySlug,
  getAllPostMeta: vi.fn().mockResolvedValue([]),
  getRelatedPosts: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/library/registry', () => ({
  getPostBySlug,
  getAllPostMeta: vi.fn().mockResolvedValue([]),
  getRelatedPosts: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/blog/seo', () => ({
  BLOG_SECTION: { basePath: '/blog' },
  buildPostMetadata: () => ({ title: 'Published article' }),
  buildPostGraphJsonLd: () => ({}),
}))
vi.mock('@/lib/library/seo', () => ({
  LIBRARY_SECTION: { basePath: '/library' },
  buildPostMetadata: () => ({ title: 'Published article' }),
  buildPostGraphJsonLd: () => ({}),
}))
vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://example.com' }))
vi.mock('@/app/(landing)/components', () => ({ ContentPostPage: () => null }))

import BlogPage, { generateMetadata as blogMetadata } from '@/app/(landing)/blog/[slug]/page'
import LibraryPage, {
  generateMetadata as libraryMetadata,
} from '@/app/(landing)/library/[slug]/page'

const POST: ContentPost = {
  slug: 'test-article',
  title: 'Published article',
  description: 'A published article for route validation.',
  date: '2026-01-01',
  author: { id: 'author', name: 'Author' },
  authors: [{ id: 'author', name: 'Author' }],
  tags: [],
  ogImage: '/cover.png',
  canonical: 'https://example.com/test-article',
  draft: false,
  featured: false,
  technical: true,
  Content: () => null,
}

beforeEach(() => vi.clearAllMocks())

describe.each([
  ['blog', BlogPage, blogMetadata],
  ['library', LibraryPage, libraryMetadata],
] as const)('%s public content routing', (_section, Page, metadata) => {
  const props = { params: Promise.resolve({ slug: POST.slug }) }

  it.each([
    ['missing', null],
    ['draft', { ...POST, draft: true }],
  ] as const)('rejects %s posts and omits their metadata', async (_state, post) => {
    getPostBySlug.mockResolvedValue(post)

    await expect(Page(props)).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404')
    await expect(metadata(props)).resolves.toEqual({})
  })

  it('serves published posts and their metadata', async () => {
    getPostBySlug.mockResolvedValue(POST)

    await expect(Page(props)).resolves.toMatchObject({ props: { post: POST } })
    await expect(metadata(props)).resolves.toEqual({ title: 'Published article' })
  })
})
