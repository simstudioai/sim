import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { buildPostGraphJsonLd, buildPostMetadata } from '@/lib/content/seo'
import { CUSTOMER_SECTION, CUSTOMER_STORIES } from '@/lib/customers/data'
import { getAllCustomerStoryMeta, getCustomerStoryBySlug } from '@/lib/customers/registry'
import { JsonLd } from '@/app/(landing)/components/json-ld/json-ld'
import { CustomerStoryPage } from '@/app/(landing)/customers/components/customer-story-page/customer-story-page'

interface CustomerPageProps {
  params: Promise<{ slug: string }>
}

export const dynamicParams = false
export const revalidate = 86400

export function generateStaticParams() {
  return CUSTOMER_STORIES.map(({ slug }) => ({ slug }))
}

export async function generateMetadata({ params }: CustomerPageProps): Promise<Metadata> {
  const { slug } = await params
  if (!CUSTOMER_STORIES.some((story) => story.slug === slug)) return {}
  const post = await getCustomerStoryBySlug(slug)
  return post ? buildPostMetadata(post) : {}
}

export default async function Page({ params }: CustomerPageProps) {
  const { slug } = await params
  const story = CUSTOMER_STORIES.find((item) => item.slug === slug)
  if (!story) notFound()
  const post = await getCustomerStoryBySlug(slug)
  if (!post) notFound()
  const published = post.draft ? [] : await getAllCustomerStoryMeta()
  const next = CUSTOMER_STORIES.find(
    (item) =>
      item.slug !== slug && (post.draft || published.some((entry) => entry.slug === item.slug))
  )
  const nextPost = next ? await getCustomerStoryBySlug(next.slug) : null

  return (
    <>
      {!post.draft && <JsonLd data={buildPostGraphJsonLd(post, CUSTOMER_SECTION)} />}
      <CustomerStoryPage
        story={story}
        post={post}
        nextStory={next && nextPost ? { story: next, post: nextPost } : undefined}
      />
    </>
  )
}
