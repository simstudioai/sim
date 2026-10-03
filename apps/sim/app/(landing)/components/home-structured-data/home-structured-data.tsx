import { SITE_URL } from '@/lib/core/utils/urls'
import { INTEGRATION_COUNT_LABEL } from '@/lib/landing/constants'
import { JsonLd } from '@/app/(landing)/components/json-ld'

/**
 * Home-page JSON-LD - the entities specific to `/`: the `WebPage`, its
 * `BreadcrumbList`, the product `WebApplication` (`#software`, with offers /
 * featureList), and the `SoftwareSourceCode`.
 *
 * Rendered only by the landing root (`landing.tsx`), server-side before visible
 * content. The site-wide `Organization` / `WebSite` entities live in
 * {@link SiteStructuredData} (emitted by the shared layout on every page); the
 * nodes here reference them by `@id` (`${SITE_URL}#website` / `#organization`).
 *
 * Maintenance:
 * - Offer prices must match the Pricing component exactly.
 * - All claims must also appear as visible text on the page.
 * - Do not add `review` or `aggregateRating` without real, rated, verifiable
 *   review data; curated testimonials do not qualify for review snippets.
 */
/**
 * The home page's canonical description - the single string shared by the
 * `<meta name="description">`, OG/Twitter cards (`page.tsx`), and the JSON-LD
 * `WebPage.description` below, so the three surfaces never drift.
 */
export const HOME_PAGE_DESCRIPTION = `Sim is the open-source AI workspace where companies build, distribute, and govern AI agents. ${INTEGRATION_COUNT_LABEL} integrations, every major LLM, permission groups, spend limits, and self-hosting.`

/**
 * The home page's canonical title - the single string shared by the
 * `<title>`, OG/Twitter titles (`page.tsx`), and the JSON-LD `WebPage.name`
 * below, so the title surfaces never drift.
 */
export const HOME_PAGE_TITLE = 'The AI Workspace | Build, Distribute & Govern AI Agents | Sim'

const HOME_JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebPage',
      '@id': `${SITE_URL}#webpage`,
      url: SITE_URL,
      name: HOME_PAGE_TITLE,
      isPartOf: { '@id': `${SITE_URL}#website` },
      about: { '@id': `${SITE_URL}#software` },
      datePublished: '2024-01-01T00:00:00+00:00',
      description: HOME_PAGE_DESCRIPTION,
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
      description: `Sim is the open-source AI workspace where companies build, distribute, and govern AI agents in one place. Teams build agents visually, conversationally, or with code across ${INTEGRATION_COUNT_LABEL} integrations and every major LLM, while administrators control model access, integration access, spend limits, and deployment. Trusted by over 100,000 builders. SOC2 compliant and self-hostable.`,
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
        'Chat: build and manage agents in natural language',
        'Visual workflow builder',
        'CLI access for coding agents and terminal workflows',
        `${INTEGRATION_COUNT_LABEL} integrations`,
        'LLM orchestration (OpenAI, Anthropic, Google, xAI, Mistral, Perplexity)',
        'Knowledge base creation',
        'Table creation',
        'Document creation',
        'API access',
        'Custom functions',
        'Scheduled workflows',
        'Event triggers',
        'Permission groups for model, integration, and tool access',
        'Organization and per-member spend limits',
        'Usage analytics by workspace and member',
        'Agent deployment as chat, API, or MCP with SSO, email, or password access',
        'Single sign-on with domain verification',
        'Audit records and run tracing',
        'Configurable data retention',
        'Self-hosting with Docker or Kubernetes',
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
