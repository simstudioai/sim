/**
 * JSON-LD structured data for the landing page.
 *
 * Renders a `<script type="application/ld+json">` with Schema.org markup.
 * Single source of truth for machine-readable page metadata.
 *
 * Schemas: Organization, WebSite, WebPage, BreadcrumbList, WebApplication, FAQPage.
 *
 * AI crawler behavior (2025-2026):
 * - Google AI Overviews / Bing Copilot parse JSON-LD from their search indexes.
 * - GPTBot indexes JSON-LD during crawling (92% of LLM crawlers parse JSON-LD first).
 * - Perplexity / Claude prioritize visible HTML over JSON-LD during direct fetch.
 * - All claims here must also appear as visible text on the page.
 *
 * Maintenance:
 * - Offer prices must match the Pricing component exactly.
 * - `sameAs` links must match the Footer social links.
 * - Do not add `aggregateRating` without real, verifiable review data.
 */
export default function StructuredData() {
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': 'https://sim.ai/#organization',
        name: 'Sim',
        alternateName: 'Sim Studio',
        description:
          'Open-source AI agent workflow builder used by developers at trail-blazing startups to Fortune 500 companies',
        url: 'https://sim.ai',
        logo: {
          '@type': 'ImageObject',
          '@id': 'https://sim.ai/#logo',
          url: 'https://sim.ai/logo/b&w/text/b&w.svg',
          contentUrl: 'https://sim.ai/logo/b&w/text/b&w.svg',
          width: 49.78314,
          height: 24.276,
          caption: 'Sim Logo',
        },
        image: { '@id': 'https://sim.ai/#logo' },
        sameAs: [
          'https://x.com/simdotai',
          'https://github.com/simstudioai/sim',
          'https://www.linkedin.com/company/simstudioai/',
          'https://discord.gg/Hr4UWYEcTT',
        ],
        contactPoint: {
          '@type': 'ContactPoint',
          contactType: 'customer support',
          availableLanguage: ['en'],
        },
      },
      {
        '@type': 'WebSite',
        '@id': 'https://sim.ai/#website',
        url: 'https://sim.ai',
        name: 'Sim — AI Agent Workflow Builder',
        description:
          'Open-source AI agent workflow builder. 60,000+ developers build and deploy agentic workflows. SOC2 and HIPAA compliant.',
        publisher: { '@id': 'https://sim.ai/#organization' },
        inLanguage: 'en-US',
      },
      {
        '@type': 'WebPage',
        '@id': 'https://sim.ai/#webpage',
        url: 'https://sim.ai',
        name: 'Sim — Workflows for LLMs | Build AI Agent Workflows',
        isPartOf: { '@id': 'https://sim.ai/#website' },
        about: { '@id': 'https://sim.ai/#software' },
        datePublished: '2024-01-01T00:00:00+00:00',
        dateModified: new Date().toISOString(),
        description:
          'Build and deploy AI agent workflows with Sim. Visual drag-and-drop interface for creating powerful LLM-powered automations.',
        breadcrumb: { '@id': 'https://sim.ai/#breadcrumb' },
        inLanguage: 'en-US',
        potentialAction: [{ '@type': 'ReadAction', target: ['https://sim.ai'] }],
      },
      {
        '@type': 'BreadcrumbList',
        '@id': 'https://sim.ai/#breadcrumb',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://sim.ai' },
        ],
      },
      {
        '@type': 'WebApplication',
        '@id': 'https://sim.ai/#software',
        name: 'Sim — AI Agent Workflow Builder',
        description:
          'Open-source AI agent workflow builder used by 60,000+ developers. Build agentic workflows with visual drag-and-drop interface. SOC2 and HIPAA compliant. Integrate with 100+ apps.',
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Web',
        browserRequirements: 'Requires a modern browser with JavaScript enabled',
        offers: [
          {
            '@type': 'Offer',
            name: 'Community Plan',
            price: '0',
            priceCurrency: 'USD',
            availability: 'https://schema.org/InStock',
          },
          {
            '@type': 'Offer',
            name: 'Pro Plan',
            price: '20',
            priceCurrency: 'USD',
            priceSpecification: {
              '@type': 'UnitPriceSpecification',
              price: '20',
              priceCurrency: 'USD',
              unitText: 'MONTH',
              billingIncrement: 1,
            },
            availability: 'https://schema.org/InStock',
          },
          {
            '@type': 'Offer',
            name: 'Team Plan',
            price: '40',
            priceCurrency: 'USD',
            priceSpecification: {
              '@type': 'UnitPriceSpecification',
              price: '40',
              priceCurrency: 'USD',
              unitText: 'MONTH',
              billingIncrement: 1,
            },
            availability: 'https://schema.org/InStock',
          },
        ],
        featureList: [
          'Visual workflow builder',
          'Drag-and-drop interface',
          '100+ integrations',
          'AI model support (OpenAI, Anthropic, Google, xAI, Mistral, Perplexity)',
          'Real-time collaboration',
          'Version control',
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
        '@type': 'FAQPage',
        '@id': 'https://sim.ai/#faq',
        mainEntity: [
          {
            '@type': 'Question',
            name: 'What is Sim?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Sim is an open-source AI agent workflow builder used by 60,000+ developers at trail-blazing startups to Fortune 500 companies. It provides a visual drag-and-drop interface for building and deploying agentic workflows. Sim is SOC2 and HIPAA compliant.',
            },
          },
          {
            '@type': 'Question',
            name: 'Which AI models does Sim support?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Sim supports all major AI models including OpenAI (GPT-5, GPT-4o), Anthropic (Claude), Google (Gemini), xAI (Grok), Mistral, Perplexity, and many more. You can also connect to open-source models via Ollama.',
            },
          },
          {
            '@type': 'Question',
            name: 'How much does Sim cost?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Sim offers a free Community plan with $20 usage limit, a Pro plan at $20/month, a Team plan at $40/month, and custom Enterprise pricing. All plans include CLI/SDK access.',
            },
          },
          {
            '@type': 'Question',
            name: 'Do I need coding skills to use Sim?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'No coding skills are required. Sim features a visual drag-and-drop interface that makes it easy to build AI workflows. However, developers can also use custom functions and the API for advanced use cases.',
            },
          },
          {
            '@type': 'Question',
            name: 'What enterprise features does Sim offer?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Sim offers SOC2 and HIPAA compliance, SSO/SAML authentication, role-based access control, audit logs, dedicated support, custom SLAs, and on-premise deployment options for enterprise customers.',
            },
          },
        ],
      },
    ],
  }

  return (
    <script
      type='application/ld+json'
      dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
    />
  )
}
