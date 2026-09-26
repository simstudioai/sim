import { createRouteContext } from '@sim/testing/helpers/http'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ContentPost } from '@/lib/content/schema'
import type { CustomerStory } from '@/lib/customers/data'
import CustomerPage from '@/app/(landing)/customers/[slug]/page'
import CustomersPage, { generateMetadata } from '@/app/(landing)/customers/page'

const { getAllMeta, getBySlug } = vi.hoisted(() => ({
  getAllMeta: vi.fn(),
  getBySlug: vi.fn(),
}))

vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/lib/customers/registry', () => ({
  getAllCustomerStoryMeta: getAllMeta,
  getCustomerStoryBySlug: getBySlug,
}))
vi.mock('@/lib/content/seo', () => ({
  buildIndexMetadata: () => ({ robots: { index: true, follow: true } }),
  buildPostMetadata: () => ({}),
  buildPostGraphJsonLd: () => ({}),
}))
vi.mock('@/app/(landing)/components/json-ld/json-ld', () => ({ JsonLd: () => null }))
vi.mock('@/app/(landing)/customers/components/customer-story-card/customer-story-card', () => ({
  CustomerStoryCard: ({ story, priority }: { story: CustomerStory; priority?: boolean }) => (
    <a href={`/customers/${story.slug}`} data-priority={priority}>
      {story.company}
    </a>
  ),
}))
vi.mock('@/app/(landing)/customers/components/customer-story-page/customer-story-page', () => ({
  CustomerStoryPage: ({
    story,
    nextStory,
  }: {
    story: CustomerStory
    nextStory?: { story: CustomerStory; post: ContentPost }
  }) => (
    <main>
      {story.company}
      {nextStory && <a href={`/customers/${nextStory.story.slug}`}>Next story</a>}
    </main>
  ),
}))

function post(slug: string, draft: boolean): ContentPost {
  return {
    slug,
    title: `${slug} customer story`,
    description: 'Customer story preview',
    date: '2026-09-05',
    author: { id: 'sim', name: 'Sim', avatarUrl: '/sim.png' },
    authors: [],
    readingTime: 2,
    tags: [],
    ogImage: '/story.png',
    canonical: `https://sim.ai/customers/${slug}`,
    draft,
    featured: false,
    technical: false,
    Content: () => null,
    headings: [],
  }
}

function setStories(rivianDraft: boolean, expDraft: boolean) {
  const posts = [post('rivian', rivianDraft), post('exp-realty', expDraft)]
  getAllMeta.mockResolvedValue(posts.filter((story) => !story.draft))
  getBySlug.mockImplementation(
    async (slug: string) => posts.find((story) => story.slug === slug) ?? null
  )
}

describe('customer publication boundaries', () => {
  it('preserves the complete noindex design preview when every story is a draft', async () => {
    setStories(true, true)
    const html = renderToStaticMarkup(await CustomersPage())
    expect(html).toContain('href="/customers/rivian"')
    expect(html).toContain('href="/customers/exp-realty"')
    expect(html.match(/data-priority="true"/g)).toHaveLength(1)
    expect((await generateMetadata()).robots).toEqual({ index: false, follow: false })
  })

  it('does not recommend a draft from a published story', async () => {
    setStories(false, true)
    const html = renderToStaticMarkup(await CustomerPage(createRouteContext({ slug: 'rivian' })))
    expect(html).not.toContain('Next story')
    expect(getBySlug).toHaveBeenCalledExactlyOnceWith('rivian')
  })
})
