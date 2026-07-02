import { SITE_URL } from '@/lib/core/utils/urls'
import { JsonLd } from '@/app/(landing)/components/json-ld'
import type { PlatformPageConfig } from '@/app/(landing)/components/platform-page/types'

/**
 * JSON-LD for a platform page - a `WebPage` (about a `WebApplication`) plus a
 * `BreadcrumbList`, rendered server-side before any visible content so crawlers
 * and AI answer engines read the structured data first.
 *
 * Everything is derived from the same {@link PlatformPageConfig} that drives the
 * visible sections, so the structured data can never drift from the page: the
 * `WebApplication.featureList` is the deduped set of card titles actually
 * rendered, the page name/description come from the hero, and the breadcrumb
 * from the module + path. The page author maintains zero schema by hand.
 *
 * Server Component; no client cost. Internal to the platform layout - emitted by
 * `PlatformPage`, never rendered by a consumer directly.
 */

interface PlatformStructuredDataProps {
  config: PlatformPageConfig
}

export function PlatformStructuredData({ config }: PlatformStructuredDataProps) {
  const { module, path, hero, rows } = config
  const url = `${SITE_URL}${path}`
  const featureList = Array.from(
    new Set(rows.flatMap((row) => row.cards.map((card) => card.title)))
  )

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${url}#webpage`,
        url,
        name: hero.heading,
        description: hero.summary,
        isPartOf: { '@id': `${SITE_URL}#website` },
        about: { '@id': `${url}#application` },
        breadcrumb: { '@id': `${url}#breadcrumb` },
        inLanguage: 'en-US',
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${url}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
          { '@type': 'ListItem', position: 2, name: module, item: url },
        ],
      },
      {
        '@type': 'WebApplication',
        '@id': `${url}#application`,
        name: `Sim ${module}`,
        description: hero.summary,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        url,
        featureList,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      },
    ],
  }

  return <JsonLd data={jsonLd} />
}
