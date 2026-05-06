import type { MetadataRoute } from 'next'
import { getBaseUrl } from '@/lib/core/utils/urls'

/**
 * Default disallow list applied to crawlers and the wildcard rule. Blocks
 * authenticated surfaces, internal endpoints, and one-time-use links.
 */
const DISALLOWED_PATHS = [
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
]

/**
 * Tighter disallow list for link-preview bots. They fetch single URLs to
 * render Open Graph cards rather than crawl, so publicly-shareable surfaces
 * like /chat/ and /form/ must be reachable for previews to render. Other
 * authenticated routes (/workspace/, /w/, /playground/) stay blocked.
 */
const LINK_PREVIEW_DISALLOWED_PATHS = [
  '/api/',
  '/workspace/',
  '/w/',
  '/playground/',
  '/resume/',
  '/invite/',
  '/unsubscribe/',
  '/credential-account/',
  '/_next/',
  '/private/',
]

/**
 * Social and messaging platforms that fetch URLs to render link previews
 * (Open Graph / Twitter Card images). These need access to publicly-shared
 * surfaces like /chat/ and /form/ that are otherwise blocked.
 */
const LINK_PREVIEW_BOTS = [
  'Twitterbot',
  'LinkedInBot',
  'Slackbot',
  'Slack-ImgProxy',
  'Discordbot',
  'TelegramBot',
  'WhatsApp',
  'facebookexternalhit',
  'Pinterestbot',
  'redditbot',
]

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getBaseUrl()

  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: DISALLOWED_PATHS },
      {
        userAgent: LINK_PREVIEW_BOTS,
        allow: '/',
        disallow: LINK_PREVIEW_DISALLOWED_PATHS,
      },
    ],
    sitemap: [`${baseUrl}/sitemap.xml`, `${baseUrl}/blog/sitemap-images.xml`],
  }
}
