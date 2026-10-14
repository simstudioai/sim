import { serializeJsonLd } from '@/lib/json-ld'
import { DOCS_BASE_URL, SIM_SITE_URL } from '@/lib/urls'

interface StructuredDataProps {
  title: string
  description: string
  url: string
  dateModified?: string
  breadcrumb?: Array<{ name: string; url: string }>
}

export function StructuredData({
  title,
  description,
  url,
  dateModified,
  breadcrumb,
}: StructuredDataProps) {
  const baseUrl = DOCS_BASE_URL
  const structuredDataId = encodeURIComponent(url)

  const articleStructuredData = {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: title,
    description: description,
    url: url,
    ...(dateModified && { dateModified }),
    author: {
      '@type': 'Organization',
      '@id': `${SIM_SITE_URL}#organization`,
      name: 'Sim',
      url: SIM_SITE_URL,
    },
    publisher: {
      '@type': 'Organization',
      '@id': `${SIM_SITE_URL}#organization`,
      name: 'Sim',
      url: SIM_SITE_URL,
      logo: {
        '@type': 'ImageObject',
        url: `${baseUrl}/static/logo.png`,
      },
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': url,
    },
    inLanguage: 'en',
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

  return (
    <>
      <script
        id={`article-json-ld-${structuredDataId}`}
        type='application/ld+json'
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(articleStructuredData),
        }}
      />
      {breadcrumbStructuredData && (
        <script
          id={`breadcrumb-json-ld-${structuredDataId}`}
          type='application/ld+json'
          dangerouslySetInnerHTML={{
            __html: serializeJsonLd(breadcrumbStructuredData),
          }}
        />
      )}
    </>
  )
}
