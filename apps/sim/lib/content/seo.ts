import type { Metadata } from 'next'
import type { Author, ContentMeta } from '@/lib/content/schema'
import { SITE_URL } from '@/lib/core/utils/urls'
import { withFilteredNoindex } from '@/lib/landing/seo'

/**
 * Identifies the content section a post/collection belongs to, so the
 * generic SEO builders below can emit section-correct breadcrumbs and
 * collection metadata without hardcoding "Blog"/"/blog" anywhere.
 */
export interface ContentSection {
  /** Display name, e.g. "Blog" or "Library". */
  name: string
  /** Route base path, e.g. "/blog" or "/library". */
  basePath: string
  /** Collection-page description used in `CollectionPage` JSON-LD. */
  description: string
}

export function buildPostMetadata(post: ContentMeta): Metadata {
  const base = new URL(post.canonical)
  const baseUrl = `${base.protocol}//${base.host}`
  return {
    title: post.title,
    description: post.description,
    keywords: post.tags,
    authors: (post.authors && post.authors.length > 0 ? post.authors : [post.author]).map((a) => ({
      name: a.name,
      url: a.url,
    })),
    creator: post.author.name,
    publisher: 'Sim',
    robots: post.draft
      ? { index: false, follow: false, googleBot: { index: false, follow: false } }
      : { index: true, follow: true, googleBot: { index: true, follow: true } },
    alternates: { canonical: post.canonical },
    openGraph: {
      title: post.title,
      description: post.description,
      url: post.canonical,
      siteName: 'Sim',
      locale: 'en_US',
      type: 'article',
      publishedTime: post.date,
      modifiedTime: post.updated ?? post.date,
      authors: (post.authors && post.authors.length > 0 ? post.authors : [post.author]).map(
        (a) => a.name
      ),
      tags: post.tags,
      images: [
        {
          url: post.ogImage.startsWith('http') ? post.ogImage : `${baseUrl}${post.ogImage}`,
          width: post.ogImageWidth ?? 1200,
          height: post.ogImageHeight ?? 630,
          alt: post.ogAlt || post.title,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.description,
      images: [post.ogImage],
      creator: post.author.url?.includes('x.com') ? `@${post.author.xHandle || ''}` : undefined,
      site: '@simdotai',
    },
    other: {
      'article:published_time': post.date,
      'article:modified_time': post.updated ?? post.date,
      'article:author': post.author.name,
      'article:section': 'Technology',
    },
  }
}

/**
 * Google's Article rich-result eligibility only recognizes `Article`,
 * `NewsArticle`, and `BlogPosting` — a bare `TechArticle` type is not in that
 * allowlist, so it silently loses rich-result eligibility. `BlogPosting` is
 * therefore always included; `TechArticle` is layered on via a multi-type
 * `@type` array (the standard schema.org way to say "this is both") only for
 * posts that are genuinely technical/developer content (`post.technical`) —
 * general announcements (funding, company news) get `BlogPosting` alone.
 */
export function buildArticleJsonLd(post: ContentMeta) {
  return {
    '@type': post.technical ? ['BlogPosting', 'TechArticle'] : 'BlogPosting',
    url: post.canonical,
    headline: post.title,
    description: post.description,
    image: [
      {
        '@type': 'ImageObject',
        url: post.ogImage.startsWith('http') ? post.ogImage : `${SITE_URL}${post.ogImage}`,
        width: post.ogImageWidth ?? 1200,
        height: post.ogImageHeight ?? 630,
        caption: post.ogAlt || post.title,
      },
    ],
    datePublished: post.date,
    dateModified: post.updated ?? post.date,
    wordCount: post.wordCount,
    ...(post.technical ? { proficiencyLevel: 'Beginner' } : {}),
    author: (post.authors && post.authors.length > 0 ? post.authors : [post.author]).map((a) => ({
      '@type': 'Person',
      name: a.name,
      url: a.url,
      ...(a.url ? { sameAs: [a.url] } : {}),
    })),
    publisher: {
      '@type': 'Organization',
      name: 'Sim',
      url: SITE_URL,
      logo: {
        '@type': 'ImageObject',
        url: `${SITE_URL}/logo/primary/medium.png`,
      },
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': post.canonical,
    },
    keywords: post.tags.join(', '),
    about: (post.about || []).map((a) => ({ '@type': 'Thing', name: a })),
    isAccessibleForFree: true,
    timeRequired: post.timeRequired,
    articleSection: 'Technology',
    inLanguage: 'en-US',
    speakable: {
      '@type': 'SpeakableSpecification',
      cssSelector: ['[itemprop="headline"]', '[itemprop="description"]'],
    },
  }
}

export function buildBreadcrumbJsonLd(post: ContentMeta, section: ContentSection) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      {
        '@type': 'ListItem',
        position: 2,
        name: section.name,
        item: `${SITE_URL}${section.basePath}`,
      },
      { '@type': 'ListItem', position: 3, name: post.title, item: post.canonical },
    ],
  }
}

export function buildFaqJsonLd(items: { q: string; a: string }[] | undefined) {
  if (!items || items.length === 0) return null
  return {
    '@type': 'FAQPage',
    mainEntity: items.map((it) => ({
      '@type': 'Question',
      name: it.q,
      acceptedAnswer: { '@type': 'Answer', text: it.a },
    })),
  }
}

export function buildPostGraphJsonLd(post: ContentMeta, section: ContentSection) {
  const graph: Record<string, unknown>[] = [
    buildArticleJsonLd(post),
    buildBreadcrumbJsonLd(post, section),
  ]

  const faq = buildFaqJsonLd(post.faq)
  if (faq) {
    graph.push(faq)
  }

  return {
    '@context': 'https://schema.org',
    '@graph': graph,
  }
}

/**
 * Filtered/paginated index variants render genuinely different lists, but
 * only the bare index is indexable — same policy as the integrations and
 * models catalogs — so canonical always points at the unfiltered index and
 * the variant itself is noindexed rather than asking Google to index every
 * tag/page permutation.
 */
export function buildIndexMetadata(
  section: ContentSection,
  { tag, pageNum }: { tag?: string; pageNum: number }
): Metadata {
  const titleParts = [section.name]
  if (tag) titleParts.push(tag)
  if (pageNum > 1) titleParts.push(`Page ${pageNum}`)
  const title = titleParts.join(' | ')

  const description = tag
    ? `Sim ${section.name.toLowerCase()} posts tagged "${tag}": ${section.description}`
    : section.description

  const canonical = `${SITE_URL}${section.basePath}`
  const isFiltered = Boolean(tag) || pageNum > 1

  return withFilteredNoindex(
    {
      title,
      description,
      alternates: { canonical },
      openGraph: {
        title: `${title} | Sim`,
        description,
        url: canonical,
        siteName: 'Sim',
        locale: 'en_US',
        type: 'website',
        images: [
          {
            url: `${SITE_URL}/logo/primary/medium.png`,
            width: 1200,
            height: 630,
            alt: `Sim ${section.name}`,
          },
        ],
      },
      twitter: {
        card: 'summary_large_image',
        title: `${title} | Sim`,
        description,
        site: '@simdotai',
      },
    },
    isFiltered
  )
}

export function buildTagsMetadata(section: ContentSection): Metadata {
  const canonical = `${SITE_URL}${section.basePath}/tags`
  const description = `Browse Sim ${section.name.toLowerCase()} posts by topic: AI agents, workflows, integrations, and more.`
  return {
    title: 'Tags',
    description,
    alternates: { canonical },
    openGraph: {
      title: `${section.name} Tags | Sim`,
      description,
      url: canonical,
      siteName: 'Sim',
      locale: 'en_US',
      type: 'website',
    },
    twitter: {
      card: 'summary',
      title: `${section.name} Tags | Sim`,
      description,
      site: '@simdotai',
    },
  }
}

export function buildTagsBreadcrumbJsonLd(section: ContentSection) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      {
        '@type': 'ListItem',
        position: 2,
        name: section.name,
        item: `${SITE_URL}${section.basePath}`,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: 'Tags',
        item: `${SITE_URL}${section.basePath}/tags`,
      },
    ],
  }
}

export function buildAuthorMetadata(
  section: ContentSection,
  id: string,
  author?: Author
): Metadata {
  const name = author?.name ?? 'Author'
  const canonical = `${SITE_URL}${section.basePath}/authors/${encodeURIComponent(id)}`
  const description = `Read articles by ${name} on the Sim ${section.name.toLowerCase()}.`
  return {
    title: `${name} | Sim ${section.name}`,
    description,
    alternates: { canonical },
    openGraph: {
      title: `${name} | Sim ${section.name}`,
      description,
      url: canonical,
      siteName: 'Sim',
      type: 'profile',
      ...(author?.avatarUrl
        ? { images: [{ url: author.avatarUrl, width: 400, height: 400, alt: name }] }
        : {}),
    },
    twitter: {
      card: 'summary',
      title: `${name} | Sim ${section.name}`,
      description,
      site: '@simdotai',
      ...(author?.xHandle ? { creator: `@${author.xHandle}` } : {}),
    },
  }
}

export function buildAuthorGraphJsonLd(section: ContentSection, author: Author) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Person',
        name: author.name,
        url: `${SITE_URL}${section.basePath}/authors/${encodeURIComponent(author.id)}`,
        sameAs: author.url ? [author.url] : [],
        image: author.avatarUrl?.startsWith('http')
          ? author.avatarUrl
          : author.avatarUrl && `${SITE_URL}${author.avatarUrl}`,
        worksFor: {
          '@type': 'Organization',
          name: 'Sim',
          url: SITE_URL,
        },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
          {
            '@type': 'ListItem',
            position: 2,
            name: section.name,
            item: `${SITE_URL}${section.basePath}`,
          },
          {
            '@type': 'ListItem',
            position: 3,
            name: author.name,
            item: `${SITE_URL}${section.basePath}/authors/${encodeURIComponent(author.id)}`,
          },
        ],
      },
    ],
  }
}

/**
 * `mainEntity` lists exactly the posts passed in, in the given order - the
 * caller (currently `selectVisiblePosts`) is responsible for sourcing them
 * from the same `getAllPostMeta()` list the index page renders from and for
 * ordering them to match the visible layout (e.g. featured-row-first), so
 * this function never re-sorts and can't diverge from what's on the page.
 *
 * `tag`/`page` describe which filtered/paginated variant `posts` came from,
 * so `url` reflects the actual page these `posts` are visible on rather than
 * always the bare section index - the same variant is `noindex`ed (see
 * `buildIndexMetadata`), but the graph still shouldn't attribute a partial
 * list to the unfiltered collection URL.
 */
export function buildCollectionPageJsonLd(
  section: ContentSection,
  posts: ContentMeta[],
  { tag, page }: { tag?: string; page?: number } = {}
) {
  const params = [
    page && page > 1 ? `page=${page}` : null,
    tag ? `tag=${encodeURIComponent(tag)}` : null,
  ]
    .filter(Boolean)
    .join('&')
  const url = `${SITE_URL}${section.basePath}${params ? `?${params}` : ''}`

  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `Sim ${section.name}`,
    url,
    description: section.description,
    publisher: {
      '@type': 'Organization',
      name: 'Sim',
      url: SITE_URL,
      logo: {
        '@type': 'ImageObject',
        url: `${SITE_URL}/logo/primary/medium.png`,
      },
    },
    inLanguage: 'en-US',
    isPartOf: {
      '@type': 'WebSite',
      name: 'Sim',
      url: SITE_URL,
    },
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: posts.map((post, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        url: post.canonical,
        item: {
          '@type': 'BlogPosting',
          headline: post.title,
          description: post.description,
          url: post.canonical,
          datePublished: post.date,
          dateModified: post.updated ?? post.date,
          image: post.ogImage.startsWith('http') ? post.ogImage : `${SITE_URL}${post.ogImage}`,
          author: {
            '@type': 'Person',
            name: post.author.name,
            ...(post.author.url ? { url: post.author.url } : {}),
          },
        },
      })),
    },
  }
}
