import type { MetadataRoute } from 'next'
import { getAllPostMeta as getAllBlogPostMeta } from '@/lib/blog/registry'
import type { ContentMeta } from '@/lib/content/schema'
import { latestModified } from '@/lib/content/utils'
import { SITE_URL } from '@/lib/core/utils/urls'
import { INTEGRATIONS, INTEGRATIONS_UPDATED_AT } from '@/lib/integrations'
import { getAllPostMeta as getAllLibraryPostMeta } from '@/lib/library/registry'
import {
  ALL_COMPETITORS,
  getLatestVerifiedDate,
  SIM_LATEST_VERIFIED,
} from '@/app/(landing)/comparisons/utils'
import { ALL_CATALOG_MODELS, MODEL_PROVIDERS_WITH_CATALOGS } from '@/app/(landing)/models/utils'

/** One sitemap entry per author, timestamped by their most recently updated post. */
function buildAuthorPages(posts: ContentMeta[], basePath: string): MetadataRoute.Sitemap {
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
  return [...authorsMap.entries()].map(([id, date]) => ({
    url: `${SITE_URL}${basePath}/authors/${encodeURIComponent(id)}`,
    lastModified: date,
  }))
}

/**
 * Generate the public sitemap by composing static landing pages with the
 * dynamic catalogs (blog posts, library posts, authors, integrations, model
 * providers, and individual models). Per-integration entries are emitted
 * under `/integrations/{slug}` to match the landing route at
 * `app/(landing)/integrations/[slug]`; slugs are guaranteed unique
 * by the catalog generator in `scripts/generate-docs.ts`.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = SITE_URL
  const [posts, libraryPosts] = await Promise.all([getAllBlogPostMeta(), getAllLibraryPostMeta()])

  const latestPostDateValue = latestModified(posts)
  const latestLibraryPostDate = latestModified(libraryPosts)

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
      url: `${baseUrl}/careers`,
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
      lastModified: latestPostDateValue,
    },
    {
      url: `${baseUrl}/blog/tags`,
      lastModified: latestPostDateValue,
    },
    {
      url: `${baseUrl}/library`,
      lastModified: latestLibraryPostDate,
    },
    {
      url: `${baseUrl}/library/tags`,
      lastModified: latestLibraryPostDate,
    },
    {
      url: `${baseUrl}/changelog`,
      lastModified: latestPostDateValue,
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
  const authorPages = buildAuthorPages(posts, '/blog')

  const libraryPages: MetadataRoute.Sitemap = libraryPosts.map((p) => ({
    url: p.canonical,
    lastModified: new Date(p.updated ?? p.date),
  }))
  const libraryAuthorPages = buildAuthorPages(libraryPosts, '/library')

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

  // Matches the max(Sim, competitor) verified-date logic each detail page's own
  // JSON-LD `dateModified` uses, so the sitemap timestamp never lags behind it.
  const competitorLastModified = (competitor: (typeof ALL_COMPETITORS)[number]) =>
    new Date(Math.max(SIM_LATEST_VERIFIED.getTime(), getLatestVerifiedDate(competitor).getTime()))

  const comparisonLastModified =
    ALL_COMPETITORS.length > 0
      ? new Date(Math.max(...ALL_COMPETITORS.map((c) => competitorLastModified(c).getTime())))
      : SIM_LATEST_VERIFIED

  const comparisonPages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/comparisons`, lastModified: comparisonLastModified },
    ...ALL_COMPETITORS.map((competitor) => ({
      url: `${baseUrl}/comparisons/${competitor.id}`,
      lastModified: competitorLastModified(competitor),
    })),
  ]

  return [
    ...staticPages,
    ...blogPages,
    ...authorPages,
    ...libraryPages,
    ...libraryAuthorPages,
    ...integrationPages,
    ...providerPages,
    ...modelEntries,
    ...comparisonPages,
  ]
}
