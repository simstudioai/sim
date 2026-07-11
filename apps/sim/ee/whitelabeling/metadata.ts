import type { Metadata } from 'next'
import { getDeploymentEnv } from '@/lib/core/config/env-flags'
import { getBaseUrl, SITE_URL } from '@/lib/core/utils/urls'
import { getBrandConfig } from '@/ee/whitelabeling/branding'

interface FaviconSet {
  svg: string
  favicon16: string
  favicon32: string
  android192: string
  android512: string
  apple: string
}

/**
 * Same "sim" wordmark per {@link getDeploymentEnv}, background color only —
 * so a dev/staging tab is never mistaken for prod at a glance. Ignored
 * entirely when `brand.faviconUrl` is set (a whitelabeled deployment's own
 * favicon always wins, regardless of which tier it's running on). Kept in
 * sync with `FAVICON_ICO_DESTINATIONS` in `next.config.ts`, which handles
 * the legacy `/favicon.ico` path the same way.
 */
const ICON_SETS: Record<ReturnType<typeof getDeploymentEnv>, FaviconSet> = {
  development: {
    svg: '/icon-dev.svg',
    favicon16: '/favicon-dev/favicon-16x16.png',
    favicon32: '/favicon-dev/favicon-32x32.png',
    android192: '/favicon-dev/android-chrome-192x192.png',
    android512: '/favicon-dev/android-chrome-512x512.png',
    apple: '/favicon-dev/apple-touch-icon.png',
  },
  staging: {
    svg: '/icon-staging.svg',
    favicon16: '/favicon-staging/favicon-16x16.png',
    favicon32: '/favicon-staging/favicon-32x32.png',
    android192: '/favicon-staging/android-chrome-192x192.png',
    android512: '/favicon-staging/android-chrome-512x512.png',
    apple: '/favicon-staging/apple-touch-icon.png',
  },
  production: {
    svg: '/icon.svg',
    favicon16: '/favicon/favicon-16x16.png',
    favicon32: '/favicon/favicon-32x32.png',
    android192: '/favicon/android-chrome-192x192.png',
    android512: '/favicon/android-chrome-512x512.png',
    apple: '/favicon/apple-touch-icon.png',
  },
}

/**
 * Generate dynamic metadata based on brand configuration
 */
export function generateBrandedMetadata(override: Partial<Metadata> = {}): Metadata {
  const brand = getBrandConfig()
  const icons = ICON_SETS[getDeploymentEnv()]

  const defaultTitle = brand.name
  const summaryFull = `Sim is the open-source AI workspace where teams build, deploy, and manage AI agents. Connect 1,000+ integrations and every major LLM to create agents that automate real work — visually, conversationally, or with code. Trusted by over 100,000 builders — from startups to Fortune 500 companies. SOC2 compliant.`
  const summaryShort = `Sim is the open-source AI workspace where teams build, deploy, and manage AI agents. Connect 1,000+ integrations and every major LLM to create agents that automate real work.`

  return {
    title: {
      template: `%s | ${brand.name}`,
      default: defaultTitle,
    },
    description: summaryShort,
    applicationName: brand.name,
    authors: [{ name: brand.name }],
    generator: 'Next.js',
    keywords: [
      'AI workspace',
      'AI agent builder',
      'AI agent workflow builder',
      'build AI agents',
      'visual workflow builder',
      'AI agents',
      'AI agent platform',
      'open-source AI agents',
      'agentic workflows',
      'LLM orchestration',
      'AI integrations',
      'knowledge base',
      'AI automation',
      'workflow builder',
      'AI workflow orchestration',
      'enterprise AI',
      'AI agent deployment',
      'intelligent automation',
      'AI tools',
    ],
    referrer: 'origin-when-cross-origin',
    creator: brand.name,
    publisher: brand.name,
    metadataBase: new URL(getBaseUrl()),
    alternates: {
      canonical: '/',
      languages: {
        'en-US': '/',
      },
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-image-preview': 'large',
        'max-video-preview': -1,
        'max-snippet': -1,
      },
    },
    openGraph: {
      type: 'website',
      locale: 'en_US',
      url: getBaseUrl(),
      title: defaultTitle,
      description: summaryFull,
      siteName: brand.name,
      images: [
        {
          url: brand.logoUrl || '/logo/426-240/reverse/small.png',
          width: 2130,
          height: 1200,
          alt: brand.name,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: defaultTitle,
      description: summaryFull,
      images: [brand.logoUrl || '/logo/426-240/reverse/small.png'],
      creator: '@simdotai',
      site: '@simdotai',
    },
    manifest: '/manifest.webmanifest',
    icons: {
      icon: [
        ...(brand.faviconUrl ? [] : [{ url: icons.svg, type: 'image/svg+xml', sizes: 'any' }]),
        { url: icons.favicon16, sizes: '16x16', type: 'image/png' },
        { url: icons.favicon32, sizes: '32x32', type: 'image/png' },
        {
          url: icons.android192,
          sizes: '192x192',
          type: 'image/png',
        },
        {
          url: icons.android512,
          sizes: '512x512',
          type: 'image/png',
        },
        ...(brand.faviconUrl ? [{ url: brand.faviconUrl, sizes: 'any', type: 'image/png' }] : []),
      ],
      apple: icons.apple,
      shortcut: brand.faviconUrl || icons.svg,
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: 'default',
      title: brand.name,
    },
    formatDetection: {
      telephone: false,
    },
    category: 'technology',
    other: {
      'apple-mobile-web-app-capable': 'yes',
      'mobile-web-app-capable': 'yes',
      'msapplication-TileColor': '#33C482',
      'msapplication-config': 'none',
    },
    ...override,
  }
}

/**
 * Generate static structured data for SEO
 */
export function generateStructuredData() {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Sim',
    description:
      'Sim is the open-source AI workspace where teams build, deploy, and manage AI agents. Connect 1,000+ integrations and every major LLM to create agents that automate real work. Trusted by over 100,000 builders. SOC2 compliant.',
    url: getBaseUrl(),
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    applicationSubCategory: 'AIWorkspace',
    areaServed: 'Worldwide',
    availableLanguage: ['en'],
    offers: {
      '@type': 'Offer',
      category: 'SaaS',
    },
    creator: {
      '@type': 'Organization',
      name: 'Sim',
      url: SITE_URL,
    },
    featureList: [
      'AI Workspace for Teams',
      'Chat — Natural Language Agent Creation',
      'Visual Workflow Builder',
      '1,000+ Integrations',
      'LLM Orchestration',
      'Knowledge Base Creation',
      'Table Creation',
      'Document Creation',
    ],
  }
}
