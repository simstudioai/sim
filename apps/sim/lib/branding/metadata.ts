import type { Metadata } from 'next'
import { getBrandConfig } from '@/lib/branding/branding'
import { getBaseUrl } from '@/lib/urls/utils'

/**
 * Generate dynamic metadata based on brand configuration
 */
export function generateBrandedMetadata(override: Partial<Metadata> = {}): Metadata {
  const brand = getBrandConfig()

  const defaultTitle = brand.name
  const summaryFull = `Sim is an open-source AI agent workflow builder. Developers at trail-blazing startups to Fortune 500 companies deploy agentic workflows on the Sim platform.  35,000+ developers are already using Sim to build and deploy AI agent workflows. Sim lets developers integrate with 100+ apps to streamline workflows with AI agents. Sim is SOC2 and HIPAA compliant, ensuring enterprise-level security.`
  const summaryShort = `Sim is an open-source AI agent workflow builder.`

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
      'AI agent',
      'AI agent builder',
      'AI agent workflow',
      'AI workflow automation',
      'visual workflow editor',
      'AI agents',
      'workflow canvas',
      'intelligent automation',
      'AI tools',
      'workflow designer',
      'artificial intelligence',
      'business automation',
      'AI agent workflows',
      'visual programming',
    ],
    referrer: 'origin-when-cross-origin',
    creator: brand.name,
    publisher: brand.name,
    metadataBase: new URL(getBaseUrl()),
    alternates: {
      canonical: '/',
      languages: {
        'en-US': '/en-US',
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
          url: brand.logoUrl || '/social/facebook.png',
          width: 1200,
          height: 630,
          alt: brand.name,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: defaultTitle,
      description: summaryFull,
      images: [brand.logoUrl || '/social/twitter.png'],
      creator: '@simstudioai',
      site: '@simstudioai',
    },
    manifest: '/manifest.webmanifest',
    icons: {
      icon: [
        { url: '/favicon/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
        { url: '/favicon/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
        {
          url: '/favicon/favicon-192x192.png',
          sizes: '192x192',
          type: 'image/png',
        },
        {
          url: '/favicon/favicon-512x512.png',
          sizes: '512x512',
          type: 'image/png',
        },
        { url: brand.faviconUrl || '/sim.png', sizes: 'any', type: 'image/png' },
      ],
      apple: '/favicon/apple-touch-icon.png',
      shortcut: brand.faviconUrl || '/favicon/favicon.ico',
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
      'msapplication-TileColor': '#701FFC', // Default Sim brand primary color
      'msapplication-config': '/favicon/browserconfig.xml',
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
      'Sim is an open-source AI agent workflow builder. Developers at trail-blazing startups to Fortune 500 companies deploy agentic workflows on the Sim platform.  30,000+ developers are already using Sim to build and deploy AI agent workflows. Sim lets developers integrate with 100+ apps to streamline workflows with AI agents. Sim is SOC2 and HIPAA compliant, ensuring enterprise-level security.',
    url: 'https://sim.ai',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web Browser',
    offers: {
      '@type': 'Offer',
      category: 'SaaS',
    },
    creator: {
      '@type': 'Organization',
      name: 'Sim',
      url: 'https://sim.ai',
    },
    featureList: [
      'Visual AI Agent Builder',
      'Workflow Canvas Interface',
      'AI Agent Automation',
      'Custom AI Workflows',
    ],
  }
}
