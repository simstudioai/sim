import type { MetadataRoute } from 'next'
import { source } from '@/lib/source'
import { DOCS_BASE_URL } from '@/lib/urls'

export const revalidate = 3600

export default function sitemap(): MetadataRoute.Sitemap {
  return source.getPages().map((page) => ({
    url: `${DOCS_BASE_URL}${page.url}`,
  }))
}
