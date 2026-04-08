interface StructuredDataProps {
  title: string
  description: string
  url: string
  lang: string
  dateModified?: string
  breadcrumb?: Array<{ name: string; url: string }>
}

export function StructuredData({
  title,
  description,
  url,
  lang,
  dateModified,
  breadcrumb,
}: StructuredDataProps) {
  const baseUrl = 'https://docs.sim.ai'

  const articleStructuredData = {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: title,
    description: description,
    url: url,
    ...(dateModified && { datePublished: dateModified }),
    ...(dateModified && { dateModified }),
    author: {
      '@type': 'Organization',
      name: 'Sim Team',
      url: baseUrl,
    },
    publisher: {
      '@type': 'Organization',
      name: 'Sim',
      url: baseUrl,
      logo: {
        '@type': 'ImageObject',
        url: `${baseUrl}/static/logo.png`,
      },
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': url,
    },
    inLanguage: lang,
    isPartOf: {
      '@type': 'WebSite',
      name: 'Sim Documentation',
      url: baseUrl,
    },
    potentialAction: {
      '@type': 'ReadAction',
      target: url,
    },
  }

  const breadcrumbStructuredData = breadcrumb && {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: breadcrumb.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  }

  const softwareStructuredData = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Sim',
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Any',
    description:
      'Sim is the open-source platform to build AI agents and run your agentic workforce. Connect 1,000+ integrations and LLMs to deploy and orchestrate agentic workflows. Create agents, workflows, knowledge bases, tables, and docs.',
    url: baseUrl,
    author: {
      '@type': 'Organization',
      name: 'Sim Team',
    },
    offers: {
      '@type': 'Offer',
      category: 'Developer Tools',
    },
    featureList: [
      'AI agent creation',
      'Agentic workflow orchestration',
      '1,000+ integrations',
      'LLM orchestration (OpenAI, Anthropic, Google, xAI, Mistral, Perplexity)',
      'Knowledge base creation',
      'Table creation',
      'Document creation',
    ],
  }

  return (
    <>
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(articleStructuredData),
        }}
      />
      {breadcrumbStructuredData && (
        <script
          type='application/ld+json'
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(breadcrumbStructuredData),
          }}
        />
      )}
      {url === baseUrl && (
        <script
          type='application/ld+json'
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(softwareStructuredData),
          }}
        />
      )}
    </>
  )
}
