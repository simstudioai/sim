import type { MetadataRoute } from 'next'
import { COURSES } from '@/lib/academy/content'
import { getAllPostMeta } from '@/lib/blog/registry'
import { SITE_URL } from '@/lib/core/utils/urls'
import { INTEGRATIONS, INTEGRATIONS_UPDATED_AT } from '@/lib/integrations'
import { ALL_CATALOG_MODELS, MODEL_PROVIDERS_WITH_CATALOGS } from '@/app/(landing)/models/utils'

/**
 * Generate the public sitemap by composing static landing pages with the
 * dynamic catalogs (blog posts, authors, integrations, model providers,
 * individual models, and academy courses). Per-integration entries are
 * emitted under `/integrations/{slug}` to match the landing route at
 * `app/(landing)/integrations/[slug]`; slugs are guaranteed unique
 * by the catalog generator in `scripts/generate-docs.ts`.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = SITE_URL
  const posts = await getAllPostMeta()

  const latestPostDate =
    posts.length > 0
      ? new Date(Math.max(...posts.map((p) => new Date(p.updated ?? p.date).getTime())))
      : undefined

  const modelTimes = MODEL_PROVIDERS_WITH_CATALOGS.flatMap((provider) =>
    provider.models.map((model) => new Date(model.pricing.updatedAt).getTime())
  )
  const latestModelDate = modelTimes.length > 0 ? new Date(Math.max(...modelTimes)) : undefined

  const integrationsUpdatedAt = new Date(`${INTEGRATIONS_UPDATED_AT}T00:00:00Z`)

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
    },
    {
      url: `${baseUrl}/workflows`,
    },
    {
      url: `${baseUrl}/pricing`,
    },
    {
      url: `${baseUrl}/demo`,
    },
    {
      url: `${baseUrl}/contact`,
    },
    {
      url: `${baseUrl}/enterprise`,
    },
    {
      url: `${baseUrl}/solutions/compliance`,
    },
    {
      url: `${baseUrl}/solutions/engineering`,
    },
    {
      url: `${baseUrl}/solutions/finance`,
    },
    {
      url: `${baseUrl}/solutions/hr`,
    },
    {
      url: `${baseUrl}/solutions/it`,
    },
    {
      url: `${baseUrl}/blog`,
      lastModified: latestPostDate,
    },
    {
      url: `${baseUrl}/blog/tags`,
      lastModified: latestPostDate,
    },
    {
      url: `${baseUrl}/changelog`,
      lastModified: latestPostDate,
    },
    {
      url: `${baseUrl}/integrations`,
      lastModified: integrationsUpdatedAt,
    },
    {
      url: `${baseUrl}/models`,
      lastModified: latestModelDate,
    },
    {
      url: `${baseUrl}/partners`,
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

  const blogPages: MetadataRoute.Sitemap = posts.map((p) => ({
    url: p.canonical,
    lastModified: new Date(p.updated ?? p.date),
  }))

  const authorsMap = new Map<string, Date>()
  for (const p of posts) {
    for (const author of p.authors ?? [p.author]) {
      const postDate = new Date(p.updated ?? p.date)
      const existing = authorsMap.get(author.id)
      if (!existing || postDate > existing) {
        authorsMap.set(author.id, postDate)
      }
    }
  }
  const authorPages: MetadataRoute.Sitemap = [...authorsMap.entries()].map(([id, date]) => ({
    url: `${baseUrl}/blog/authors/${id}`,
    lastModified: date,
  }))

  const integrationPages: MetadataRoute.Sitemap = INTEGRATIONS.map((integration) => ({
    url: `${baseUrl}/integrations/${integration.slug}`,
    lastModified: integrationsUpdatedAt,
  }))

  const providerPages: MetadataRoute.Sitemap = MODEL_PROVIDERS_WITH_CATALOGS.flatMap((provider) => {
    if (provider.models.length === 0) return []
    return [
      {
        url: `${baseUrl}${provider.href}`,
        lastModified: new Date(
          Math.max(...provider.models.map((model) => new Date(model.pricing.updatedAt).getTime()))
        ),
      },
    ]
  })

  const modelEntries: MetadataRoute.Sitemap = ALL_CATALOG_MODELS.map((model) => ({
    url: `${baseUrl}${model.href}`,
    lastModified: new Date(model.pricing.updatedAt),
  }))

  const academyPages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/academy` },
    ...COURSES.map((course) => ({
      url: `${baseUrl}/academy/${course.slug}`,
    })),
  ]

  return [
    ...staticPages,
    ...blogPages,
    ...authorPages,
    ...integrationPages,
    ...providerPages,
    ...modelEntries,
    ...academyPages,
  ]
}
