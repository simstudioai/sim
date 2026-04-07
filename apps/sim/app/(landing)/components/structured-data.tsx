/**
 * JSON-LD structured data for the landing page.
 *
 * Renders a `<script type="application/ld+json">` with Schema.org markup.
 * Single source of truth for machine-readable page metadata.
 *
 * Schemas: Organization, WebSite, WebPage, BreadcrumbList, WebApplication, SoftwareSourceCode, FAQPage.
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
          'Sim is the open-source platform to build AI agents and run your agentic workforce. Connect 1,000+ integrations and LLMs to deploy and orchestrate agentic workflows.',
        url: 'https://sim.ai',
        logo: {
          '@type': 'ImageObject',
          '@id': 'https://sim.ai/#logo',
          url: 'https://sim.ai/logo/b%26w/text/b%26w.svg',
          contentUrl: 'https://sim.ai/logo/b%26w/text/b%26w.svg',
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
        name: 'Sim — Build AI Agents & Run Your Agentic Workforce',
        description:
          'Sim is the open-source platform to build AI agents and run your agentic workforce. Connect 1,000+ integrations and LLMs to deploy and orchestrate agentic workflows. Join 100,000+ builders.',
        publisher: { '@id': 'https://sim.ai/#organization' },
        inLanguage: 'en-US',
      },
      {
        '@type': 'WebPage',
        '@id': 'https://sim.ai/#webpage',
        url: 'https://sim.ai',
        name: 'Sim — Build AI Agents & Run Your Agentic Workforce',
        isPartOf: { '@id': 'https://sim.ai/#website' },
        about: { '@id': 'https://sim.ai/#software' },
        datePublished: '2024-01-01T00:00:00+00:00',
        dateModified: new Date().toISOString(),
        description:
          'Sim is the open-source platform to build AI agents and run your agentic workforce. Connect 1,000+ integrations and LLMs to deploy and orchestrate agentic workflows. Create agents, workflows, knowledge bases, tables, and docs.',
        breadcrumb: { '@id': 'https://sim.ai/#breadcrumb' },
        inLanguage: 'en-US',
        speakable: {
          '@type': 'SpeakableSpecification',
          cssSelector: ['#hero-heading', '[id="hero"] p'],
        },
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
        url: 'https://sim.ai',
        name: 'Sim — Build AI Agents & Run Your Agentic Workforce',
        description:
          'Sim is the open-source platform to build AI agents and run your agentic workforce. Connect 1,000+ integrations and LLMs to deploy and orchestrate agentic workflows. Create agents, workflows, knowledge bases, tables, and docs. Trusted by over 100,000 builders. SOC2 compliant.',
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Web',
        browserRequirements: 'Requires a modern browser with JavaScript enabled',
        offers: [
          {
            '@type': 'Offer',
            name: 'Community Plan — 1,000 credits included',
            price: '0',
            priceCurrency: 'USD',
            availability: 'https://schema.org/InStock',
          },
          {
            '@type': 'Offer',
            name: 'Pro Plan — 6,000 credits/month',
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
            name: 'Max Plan — 25,000 credits/month',
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
          'AI agent creation',
          'Agentic workflow orchestration',
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
        '@id': 'https://sim.ai/#source',
        codeRepository: 'https://github.com/simstudioai/sim',
        programmingLanguage: ['TypeScript', 'Python'],
        runtimePlatform: 'Node.js',
        license: 'https://opensource.org/licenses/AGPL-3.0',
        isPartOf: { '@id': 'https://sim.ai/#software' },
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
              text: 'Sim is the open-source platform to build AI agents and run your agentic workforce. Teams connect 1,000+ integrations and LLMs to deploy and orchestrate agentic workflows. Create agents, workflows, knowledge bases, tables, and docs. Trusted by over 100,000 builders. SOC2 compliant.',
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
              text: 'Sim offers a free Community plan with 1,000 credits to start, a Pro plan at $25/month with 6,000 credits, a Max plan at $100/month with 25,000 credits, team plans available for both tiers, and custom Enterprise pricing. All plans include CLI/SDK access.',
            },
          },
          {
            '@type': 'Question',
            name: 'Do I need coding skills to use Sim?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'No coding skills are required. Sim provides a visual interface for building AI agents and agentic workflows. Developers can also use custom functions, the API, and the CLI/SDK for advanced use cases.',
            },
          },
          {
            '@type': 'Question',
            name: 'What enterprise features does Sim offer?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Sim offers SOC2 compliance, SSO/SAML authentication, role-based access control, audit logs, dedicated support, custom SLAs, and on-premise deployment options for enterprise customers.',
            },
          },
          {
            '@type': 'Question',
            name: 'Is Sim open source?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Yes. Sim is fully open source under the AGPL-3.0 license. The source code is available on GitHub at github.com/simstudioai/sim. You can self-host Sim or use the hosted version at sim.ai.',
            },
          },
          {
            '@type': 'Question',
            name: 'What integrations does Sim support?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Sim supports 1,000+ integrations including Slack, Gmail, GitHub, Notion, Airtable, Supabase, HubSpot, Salesforce, Jira, Linear, Google Drive, Google Sheets, Confluence, Discord, Microsoft Teams, Outlook, Telegram, Stripe, Pinecone, and Firecrawl. New integrations are added regularly.',
            },
          },
          {
            '@type': 'Question',
            name: 'Can I self-host Sim?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Yes. Sim can be self-hosted using Docker. Documentation is available at docs.sim.ai/self-hosting. Enterprise customers can also get dedicated infrastructure and on-premise deployment.',
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
