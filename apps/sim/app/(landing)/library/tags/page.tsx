import type { Metadata } from 'next'
import { getAllTags } from '@/lib/library/registry'
import { buildTagsBreadcrumbJsonLd, buildTagsMetadata, LIBRARY_SECTION } from '@/lib/library/seo'
import { ContentTagsPage } from '@/app/(landing)/components'

export const metadata: Metadata = buildTagsMetadata()

export default async function TagsIndex() {
  const tags = await getAllTags()
  return (
    <ContentTagsPage
      basePath={LIBRARY_SECTION.basePath}
      tags={tags}
      breadcrumbJsonLd={buildTagsBreadcrumbJsonLd()}
    />
  )
}
