import type { MetadataRoute } from 'next'
import { getBaseUrl } from '@/lib/core/utils/urls'

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

/** Looser disallow than the wildcard so OG previews can fetch /chat/ and /form/. */
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
