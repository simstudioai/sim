import type { Metadata } from 'next'
import type { BlogMeta } from './schema'

export function buildPostMetadata(post: BlogMeta): Metadata {
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
          width: 1200,
          height: 630,
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

export function buildArticleJsonLd(post: BlogMeta) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    image: [
      {
        '@type': 'ImageObject',
        url: post.ogImage,
        caption: post.ogAlt || post.title,
      },
    ],
    datePublished: post.date,
    dateModified: post.updated ?? post.date,
    author: (post.authors && post.authors.length > 0 ? post.authors : [post.author]).map((a) => ({
      '@type': 'Person',
      name: a.name,
      url: a.url,
    })),
    publisher: {
      '@type': 'Organization',
      name: 'Sim',
      logo: {
        '@type': 'ImageObject',
        url: 'https://sim.ai/logo/primary/medium.png',
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
  }
}

export function buildBreadcrumbJsonLd(post: BlogMeta) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://sim.ai' },
      { '@type': 'ListItem', position: 2, name: 'Sim Studio', item: 'https://sim.ai/studio' },
      { '@type': 'ListItem', position: 3, name: post.title, item: post.canonical },
    ],
  }
}

export function buildFaqJsonLd(items: { q: string; a: string }[] | undefined) {
  if (!items || items.length === 0) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((it) => ({
      '@type': 'Question',
      name: it.q,
      acceptedAnswer: { '@type': 'Answer', text: it.a },
    })),
  }
}

export function buildBlogJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'Sim Studio',
    url: 'https://sim.ai/studio',
    description: 'Announcements, insights, and guides for building AI agent workflows.',
  }
}
