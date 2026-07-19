import type { Metadata } from 'next'
import { getAllTags } from '@/lib/blog/registry'
import { BLOG_SECTION, buildTagsBreadcrumbJsonLd, buildTagsMetadata } from '@/lib/blog/seo'
import { ContentTagsPage } from '@/app/(landing)/components'

export const metadata: Metadata = buildTagsMetadata()

export default async function TagsIndex() {
  const tags = await getAllTags()
  return (
    <ContentTagsPage
      basePath={BLOG_SECTION.basePath}
      tags={tags}
      breadcrumbJsonLd={buildTagsBreadcrumbJsonLd()}
    />
  )
}
