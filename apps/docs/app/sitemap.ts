import type { MetadataRoute } from 'next'
import { source } from '@/lib/source'
import { DOCS_BASE_URL } from '@/lib/urls'

export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // The docs root redirects to /introduction, which is listed on its own.
  const entries: MetadataRoute.Sitemap = []
  for (const page of source.getPages()) {
    if (page.url === '/') continue
    const data = page.data.type === 'docs' ? await page.data.load() : undefined
    entries.push({
      url: `${DOCS_BASE_URL}${page.url}`,
      lastModified: data?.lastModified,
    })
  }
  return entries
}
