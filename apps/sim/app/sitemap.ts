import type { MetadataRoute } from 'next'
import { getAllPostMeta } from '@/lib/blog/registry'
import { getBaseUrl } from '@/lib/core/utils/urls'
import integrations from '@/app/(landing)/integrations/data/integrations.json'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getBaseUrl()

  const now = new Date()

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: now,
    },
    {
      url: `${baseUrl}/blog`,
      lastModified: now,
    },
    {
      url: `${baseUrl}/blog/tags`,
      lastModified: now,
    },
    // {
    //   url: `${baseUrl}/templates`,
    //   lastModified: now,
    // },
    {
      url: `${baseUrl}/integrations`,
      lastModified: now,
    },
    {
      url: `${baseUrl}/changelog`,
      lastModified: now,
    },
    {
      url: `${baseUrl}/terms`,
      lastModified: new Date('2024-10-14'),
    },
    {
      url: `${baseUrl}/privacy`,
      lastModified: new Date('2024-10-14'),
    },
  ]

  const posts = await getAllPostMeta()
  const blogPages: MetadataRoute.Sitemap = posts.map((p) => ({
    url: p.canonical,
    lastModified: new Date(p.updated ?? p.date),
  }))

  const integrationPages: MetadataRoute.Sitemap = integrations.map((i) => ({
    url: `${baseUrl}/integrations/${i.slug}`,
    lastModified: now,
  }))

  return [...staticPages, ...blogPages, ...integrationPages]
}
