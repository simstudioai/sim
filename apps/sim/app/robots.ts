import type { MetadataRoute } from 'next'
import { getBaseUrl } from '@/lib/core/utils/urls'

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getBaseUrl()

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/workspace/',
          '/chat/',
          '/playground/',
          '/resume/',
          '/invite/',
          '/unsubscribe/',
          '/w/',
          '/form/',
          '/credential-account/',
          '/_next/',
          '/private/',
          '/blog*tag=',
        ],
      },
    ],
    sitemap: [`${baseUrl}/sitemap.xml`, `${baseUrl}/blog/sitemap-images.xml`],
  }
}
