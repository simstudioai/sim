import type { MetadataRoute } from 'next'
import { source } from '@/lib/source'
import { DOCS_BASE_URL } from '@/lib/urls'

export const revalidate = 3600

export default function sitemap(): MetadataRoute.Sitemap {
  // The docs root redirects to /introduction, which is listed on its own.
  return source
    .getPages()
    .filter((page) => page.url !== '/')
    .map((page) => ({
      url: `${DOCS_BASE_URL}${page.url}`,
      lastModified: 'lastModified' in page.data ? page.data.lastModified : undefined,
    }))
}
