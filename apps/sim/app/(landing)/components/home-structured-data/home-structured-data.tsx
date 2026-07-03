import { SITE_URL } from '@/lib/core/utils/urls'
import { JsonLd } from '@/app/(landing)/components/json-ld'

/**
 * Home-page JSON-LD - the entities specific to `/`: the `WebPage`, its
 * `BreadcrumbList`, the product `WebApplication` (`#software`, with offers /
 * featureList / reviews), and the `SoftwareSourceCode`.
 *
 * Rendered only by the landing root (`landing.tsx`), server-side before visible
 * content. The site-wide `Organization` / `WebSite` entities live in
 * {@link SiteStructuredData} (emitted by the shared layout on every page); the
 * nodes here reference them by `@id` (`${SITE_URL}#website` / `#organization`).
 *
 * Maintenance:
 * - Offer prices must match the Pricing component exactly.
 * - All claims must also appear as visible text on the page.
 * - Do not add `aggregateRating` without real, verifiable review data.
 */
const HOME_JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebPage',
      '@id': `${SITE_URL}#webpage`,
      url: SITE_URL,
      name: 'Sim, The AI Workspace | Build, Deploy & Manage AI Agents',
      isPartOf: { '@id': `${SITE_URL}#website` },
      about: { '@id': `${SITE_URL}#software` },
      datePublished: '2024-01-01T00:00:00+00:00',
      description:
        'Sim is the open-source AI workspace where teams build, deploy, and manage AI agents. Connect 1,000+ integrations and every major LLM to create agents that automate real work.',
      breadcrumb: { '@id': `${SITE_URL}#breadcrumb` },
      inLanguage: 'en-US',
      speakable: {
        '@type': 'SpeakableSpecification',
        cssSelector: ['#hero-heading', '[id="hero"] p'],
      },
      potentialAction: [{ '@type': 'ReadAction', target: [SITE_URL] }],
    },
    {
      '@type': 'BreadcrumbList',
      '@id': `${SITE_URL}#breadcrumb`,
      itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL }],
    },
    {
      '@type': 'WebApplication',
      '@id': `${SITE_URL}#software`,
      url: SITE_URL,
      name: 'Sim, The AI Workspace',
      description:
        'Sim is the open-source AI workspace where teams build, deploy, and manage AI agents. Connect 1,000+ integrations and every major LLM to create agents that automate real work, visually, conversationally, or with code. Trusted by over 100,000 builders. SOC2 compliant.',
      applicationCategory: 'BusinessApplication',
      applicationSubCategory: 'AI Workspace',
      operatingSystem: 'Web',
      browserRequirements: 'Requires a modern browser with JavaScript enabled',
      installUrl: `${SITE_URL}/signup`,
      offers: [
        {
          '@type': 'Offer',
          name: 'Community Plan: 1,000 credits included',
          price: '0',
          priceCurrency: 'USD',
          availability: 'https://schema.org/InStock',
        },
        {
          '@type': 'Offer',
          name: 'Pro Plan: 6,000 credits/month',
          price: '25',
          priceCurrency: 'USD',
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price: '25',
            priceCurrency: 'USD',
            unitText: 'MONTH',
            billingIncrement: 1,
          },
          availability: 'https://schema.org/InStock',
        },
        {
          '@type': 'Offer',
          name: 'Max Plan: 25,000 credits/month',
          price: '100',
          priceCurrency: 'USD',
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price: '100',
            priceCurrency: 'USD',
            unitText: 'MONTH',
            billingIncrement: 1,
          },
          availability: 'https://schema.org/InStock',
        },
      ],
      featureList: [
        'AI workspace for teams',
        'Mothership: natural language agent creation',
        'Visual workflow builder',
        '1,000+ integrations',
        'LLM orchestration (OpenAI, Anthropic, Google, xAI, Mistral, Perplexity)',
        'Knowledge base creation',
        'Table creation',
        'Document creation',
        'API access',
        'Custom functions',
        'Scheduled workflows',
        'Event triggers',
      ],
      review: [
        {
          '@type': 'Review',
          author: { '@type': 'Person', name: 'Hasan Toor' },
          reviewBody:
            'This startup just dropped the fastest way to build AI agents. This Figma-like canvas to build agents will blow your mind.',
          url: 'https://x.com/hasantoxr/status/1912909502036525271',
        },
        {
          '@type': 'Review',
          author: { '@type': 'Person', name: 'nizzy' },
          reviewBody:
            'This is the zapier of agent building. I always believed that building agents and using AI should not be limited to technical people. I think this solves just that.',
          url: 'https://x.com/nizzyabi/status/1907864421227180368',
        },
        {
          '@type': 'Review',
          author: { '@type': 'Organization', name: 'xyflow' },
          reviewBody: 'A very good looking agent workflow builder and open source!',
          url: 'https://x.com/xyflowdev/status/1909501499719438670',
        },
      ],
    },
    {
      '@type': 'SoftwareSourceCode',
      '@id': `${SITE_URL}#source`,
      codeRepository: 'https://github.com/simstudioai/sim',
      programmingLanguage: ['TypeScript', 'Python'],
      runtimePlatform: 'Node.js',
      license: 'https://opensource.org/licenses/Apache-2.0',
      isPartOf: { '@id': `${SITE_URL}#software` },
    },
  ],
}

export function HomeStructuredData() {
  return <JsonLd data={HOME_JSON_LD} />
}
