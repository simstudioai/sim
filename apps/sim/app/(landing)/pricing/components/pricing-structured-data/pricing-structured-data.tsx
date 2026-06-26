import { CREDIT_TIERS } from '@/lib/billing/constants'
import { SITE_URL } from '@/lib/core/utils/urls'
import { COMPARISON_SECTIONS } from '@/app/workspace/[workspaceId]/upgrade/components/comparison-table/comparison-data'

/**
 * JSON-LD for the public pricing page — a `WebPage` (about a `WebApplication`),
 * a `BreadcrumbList`, and the `WebApplication` (Sim) carrying one `Offer` per
 * plan tier. Rendered server-side before any visible content so crawlers and AI
 * answer engines read the structured pricing first. Mirrors the platform/
 * solutions structured-data shape so the landing family stays consistent.
 *
 * Everything is derived from the same shared sources that drive the visible cards
 * — Pro/Max monthly prices from {@link CREDIT_TIERS} and the `featureList` from
 * the shared `COMPARISON_SECTIONS` — so the structured data can never drift from
 * the page. Free is `$0`; Enterprise is custom and intentionally ships no price.
 *
 * Server Component; no client cost.
 */

const PAGE_URL = `${SITE_URL}/pricing`

/** Feature list derived from the comparison data the cards render, so it can't drift. */
const FEATURE_LIST = Array.from(
  new Set(COMPARISON_SECTIONS.flatMap((section) => section.rows.map((row) => row.label)))
)

export function PricingStructuredData() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${PAGE_URL}#webpage`,
        url: PAGE_URL,
        name: 'Pricing — Sim, the AI Workspace',
        description:
          'Pricing for Sim, the open-source AI workspace where teams build, deploy, and manage AI agents. Compare the Free, Pro, Max, and Enterprise plans.',
        isPartOf: { '@id': `${SITE_URL}#website` },
        about: { '@id': `${PAGE_URL}#application` },
        breadcrumb: { '@id': `${PAGE_URL}#breadcrumb` },
        inLanguage: 'en-US',
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${PAGE_URL}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
          { '@type': 'ListItem', position: 2, name: 'Pricing', item: PAGE_URL },
        ],
      },
      {
        '@type': 'WebApplication',
        '@id': `${PAGE_URL}#application`,
        name: 'Sim',
        description:
          'Sim is the open-source AI workspace where teams build, deploy, and manage AI agents — connecting 1,000+ integrations and every major LLM.',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        url: SITE_URL,
        featureList: FEATURE_LIST,
        offers: [
          {
            '@type': 'Offer',
            name: 'Free',
            price: '0',
            priceCurrency: 'USD',
            description: 'Start building AI agents for free.',
          },
          {
            '@type': 'Offer',
            name: 'Pro',
            price: String(CREDIT_TIERS[0].dollars),
            priceCurrency: 'USD',
            description: 'For growing teams. Billed per user/month.',
          },
          {
            '@type': 'Offer',
            name: 'Max',
            price: String(CREDIT_TIERS[1].dollars),
            priceCurrency: 'USD',
            description: 'For scaling businesses. Billed per user/month.',
          },
          {
            '@type': 'Offer',
            name: 'Enterprise',
            priceCurrency: 'USD',
            description: 'Custom limits and infrastructure for large organizations.',
          },
        ],
      },
    ],
  }

  return (
    <script
      type='application/ld+json'
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  )
}
