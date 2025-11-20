import type { MetadataRoute } from 'next'
import { getAllPostMeta } from '@/lib/blog/registry'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = 'https://sim.ai'

  const now = new Date()

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: now,
      priority: 1.0, // Homepage - highest priority
    },
    {
      url: `${baseUrl}/studio`,
      lastModified: now,
      priority: 0.9, // Blog index - high value content
    },
    {
      url: `${baseUrl}/studio/tags`,
      lastModified: now,
      priority: 0.7, // Tags page - discovery/navigation
    },
    {
      url: `${baseUrl}/templates`,
      lastModified: now,
      priority: 0.8, // Templates - important discovery page
    },
    {
      url: `${baseUrl}/changelog`,
      lastModified: now,
      priority: 0.8, // Changelog - important for users
    },
    {
      url: `${baseUrl}/careers`,
      lastModified: new Date('2024-10-06'),
      priority: 0.6, // Careers - important but not core content
    },
    {
      url: `${baseUrl}/terms`,
      lastModified: new Date('2024-10-14'),
      priority: 0.5, // Terms - utility page
    },
    {
      url: `${baseUrl}/privacy`,
      lastModified: new Date('2024-10-14'),
      priority: 0.5, // Privacy - utility page
    },
  ]

  const posts = await getAllPostMeta()
  const blogPages: MetadataRoute.Sitemap = posts.map((p) => ({
    url: p.canonical,
    lastModified: new Date(p.updated ?? p.date),
    priority: 0.9, // Blog posts - high value content
  }))

  return [...staticPages, ...blogPages]
}
