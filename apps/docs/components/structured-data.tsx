import Script from 'next/script'

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
    datePublished: dateModified || new Date().toISOString(),
    dateModified: dateModified || new Date().toISOString(),
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

  const websiteStructuredData = url === baseUrl && {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Sim Documentation',
    url: baseUrl,
    description:
      'Comprehensive documentation for Sim visual workflow builder for AI applications. Create powerful AI agents, automation workflows, and data processing pipelines.',
    publisher: {
      '@type': 'Organization',
      name: 'Sim',
      url: baseUrl,
    },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${baseUrl}/search?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
    inLanguage: ['en', 'fr', 'zh'],
  }

  const faqStructuredData = title.toLowerCase().includes('faq') && {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [],
  }

  const softwareStructuredData = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Sim',
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Any',
    description:
      'Visual workflow builder for AI applications. Create powerful AI agents, automation workflows, and data processing pipelines by connecting blocks on a canvas—no coding required.',
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
      'Visual workflow builder with drag-and-drop interface',
      'AI agent creation and automation',
      '80+ built-in integrations',
      'Real-time team collaboration',
      'Multiple deployment options',
      'Custom integrations via MCP protocol',
    ],
  }

  return (
    <>
      <Script
        id='article-structured-data'
        type='application/ld+json'
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(articleStructuredData),
        }}
      />
      {breadcrumbStructuredData && (
        <Script
          id='breadcrumb-structured-data'
          type='application/ld+json'
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(breadcrumbStructuredData),
          }}
        />
      )}
      {websiteStructuredData && (
        <Script
          id='website-structured-data'
          type='application/ld+json'
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(websiteStructuredData),
          }}
        />
      )}
      {faqStructuredData && (
        <Script
          id='faq-structured-data'
          type='application/ld+json'
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(faqStructuredData),
          }}
        />
      )}
      {url === baseUrl && (
        <Script
          id='software-structured-data'
          type='application/ld+json'
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(softwareStructuredData),
          }}
        />
      )}
    </>
  )
}
