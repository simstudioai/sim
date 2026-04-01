import type { MetadataRoute } from 'next'
import { getAllPostMeta } from '@/lib/blog/registry'
import { getBaseUrl } from '@/lib/core/utils/urls'
import integrations from '@/app/(landing)/integrations/data/integrations.json'
import { ALL_CATALOG_MODELS, MODEL_PROVIDERS_WITH_CATALOGS } from '@/app/(landing)/models/utils'

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
      url: `${baseUrl}/models`,
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

  const providerPages: MetadataRoute.Sitemap = MODEL_PROVIDERS_WITH_CATALOGS.map((provider) => ({
    url: `${baseUrl}${provider.href}`,
    lastModified: now,
  }))

  const modelPages: MetadataRoute.Sitemap = ALL_CATALOG_MODELS.map((model) => ({
    url: `${baseUrl}${model.href}`,
    lastModified: new Date(model.pricing.updatedAt),
  }))

  return [...staticPages, ...blogPages, ...integrationPages, ...providerPages, ...modelPages]
}
