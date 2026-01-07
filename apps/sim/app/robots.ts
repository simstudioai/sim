import type { MetadataRoute } from 'next'
import { getBaseUrl } from '@/lib/core/utils/urls'

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getBaseUrl()

  const disallowedPaths = [
    '/api/',
    '/workspace/',
    '/chat/',
    '/playground/',
    '/resume/',
    '/invite/',
    '/unsubscribe/',
    '/w/',
    '/_next/',
    '/private/',
  ]

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: disallowedPaths,
      },
      {
        userAgent: 'Googlebot',
        allow: '/',
        disallow: disallowedPaths,
      },
      {
        userAgent: 'Bingbot',
        allow: '/',
        disallow: disallowedPaths,
      },
      {
        userAgent: 'YandexBot',
        allow: '/',
        disallow: disallowedPaths,
      },
      {
        userAgent: 'Baiduspider',
        allow: '/',
        disallow: disallowedPaths,
      },
      {
        userAgent: 'GPTBot',
        allow: '/',
        disallow: disallowedPaths,
      },
      {
        userAgent: 'ChatGPT-User',
        allow: '/',
        disallow: disallowedPaths,
      },
      {
        userAgent: 'OAI-SearchBot',
        allow: '/',
        disallow: disallowedPaths,
      },
      {
        userAgent: 'ClaudeBot',
        allow: '/',
        disallow: disallowedPaths,
      },
      {
        userAgent: 'Claude-SearchBot',
        allow: '/',
        disallow: disallowedPaths,
      },
      {
        userAgent: 'Google-Extended',
        allow: '/',
        disallow: disallowedPaths,
      },
      {
        userAgent: 'PerplexityBot',
        allow: '/',
        disallow: disallowedPaths,
      },
      {
        userAgent: 'Meta-ExternalAgent',
        allow: '/',
        disallow: disallowedPaths,
      },
      {
        userAgent: 'FacebookBot',
        allow: '/',
        disallow: disallowedPaths,
      },
      {
        userAgent: 'Applebot',
        allow: '/',
        disallow: disallowedPaths,
      },
      {
        userAgent: 'Applebot-Extended',
        allow: '/',
        disallow: disallowedPaths,
      },
      {
        userAgent: 'Amazonbot',
        allow: '/',
        disallow: disallowedPaths,
      },
      {
        userAgent: 'Bytespider',
        allow: '/',
        disallow: disallowedPaths,
      },
      {
        userAgent: 'CCBot',
        allow: '/',
        disallow: disallowedPaths,
      },
      {
        userAgent: 'cohere-ai',
        allow: '/',
        disallow: disallowedPaths,
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  }
}
