import type { MetadataRoute } from 'next'
import { getPages } from '@/lib/content/catalog'
import { DOCS_BASE_URL } from '@/lib/urls'

export default function sitemap(): MetadataRoute.Sitemap {
  return getPages()
    .filter((page) => page.url !== '/')
    .map((page) => ({ url: `${DOCS_BASE_URL}${page.url}`, lastModified: page.lastModified }))
}
