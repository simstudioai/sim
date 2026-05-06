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
 * Search engines and AI/answer-engine crawlers explicitly allow-listed for
 * SEO/AEO/GEO. Explicit Allow rules ensure these bots are not accidentally
 * suppressed by downstream filters and signal intent to operators that
 * publish allow-list audits (Profound, Scrunch, Otterly, etc.).
 */
const SEARCH_AND_AI_BOTS = [
  // Western search engines
  'Googlebot',
  'Bingbot',
  'DuckDuckBot',
  'Kagibot',
  // Regional search engines
  'YandexBot',
  'Baiduspider',
  'Sogou web spider',
  'Yeti',
  'SeznamBot',
  'PetalBot',
  // OpenAI
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  // Anthropic
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  // Google AI
  'Google-Extended',
  // Perplexity
  'PerplexityBot',
  'Perplexity-User',
  // Apple
  'Applebot',
  'Applebot-Extended',
  // Meta
  'Meta-ExternalAgent',
  'Meta-ExternalFetcher',
  'FacebookBot',
  // Other major AI / answer engines
  'Amazonbot',
  'CCBot',
  'cohere-ai',
  'cohere-training-data-crawler',
  'GrokBot',
  'xAI-Grok',
  'Grok-DeepSearch',
  'MistralAI-User',
  'DeepSeek-AI',
  'YouBot',
  'Diffbot',
  'AI2Bot',
  'Timpibot',
  'ImageSiftBot',
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
      { userAgent: SEARCH_AND_AI_BOTS, allow: '/', disallow: DISALLOWED_PATHS },
      {
        userAgent: LINK_PREVIEW_BOTS,
        allow: '/',
        disallow: LINK_PREVIEW_DISALLOWED_PATHS,
      },
    ],
    sitemap: [`${baseUrl}/sitemap.xml`, `${baseUrl}/blog/sitemap-images.xml`],
  }
}
