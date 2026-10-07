import type { MetadataRoute } from 'next'

/**
 * Only `/api/` is blocked from crawling. App and utility surfaces stay
 * crawlable so search engines can see the `X-Robots-Tag: noindex` the proxy
 * sends on them (a disallowed URL can still be indexed from external links),
 * and `/_next/` stays crawlable so pages render with their scripts, styles,
 * and images.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/'] },
  }
}
