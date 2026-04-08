import type { MetadataRoute } from 'next'
import { getAllPostMeta } from '@/lib/blog/registry'
import { getBaseUrl } from '@/lib/core/utils/urls'
import integrations from '@/app/(landing)/integrations/data/integrations.json'
import { ALL_CATALOG_MODELS, MODEL_PROVIDERS_WITH_CATALOGS } from '@/app/(landing)/models/utils'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getBaseUrl()

  const now = new Date()
  const integrationPages: MetadataRoute.Sitemap = integrations.map((integration) => ({
    url: `${baseUrl}/integrations/${integration.slug}`,
    lastModified: now,
  }))
  const modelHubPages: MetadataRoute.Sitemap = [
    {
      url: `${baseUrl}/integrations`,
      lastModified: now,
    },
    {
      url: `${baseUrl}/models`,
      lastModified: now,
    },
    {
      url: `${baseUrl}/partners`,
      lastModified: now,
    },
  ]
  const providerPages: MetadataRoute.Sitemap = MODEL_PROVIDERS_WITH_CATALOGS.map((provider) => ({
    url: `${baseUrl}${provider.href}`,
    lastModified: new Date(
      Math.max(...provider.models.map((model) => new Date(model.pricing.updatedAt).getTime()))
    ),
  }))
  const modelPages: MetadataRoute.Sitemap = ALL_CATALOG_MODELS.map((model) => ({
    url: `${baseUrl}${model.href}`,
    lastModified: new Date(model.pricing.updatedAt),
  }))

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: now,
    },
    {
      url: `${baseUrl}/blog`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.8,
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
    changeFrequency: 'weekly',
    priority: 0.7,
  }))

  return [
    ...staticPages,
    ...modelHubPages,
    ...integrationPages,
    ...providerPages,
    ...modelPages,
    ...blogPages,
  ]
}
