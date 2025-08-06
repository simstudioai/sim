import type { Metadata } from 'next'
import { getBrandConfig } from '@/lib/branding/branding'
import { env } from '@/lib/env'
import { getAssetUrl } from '@/lib/utils'

/**
 * Generate dynamic metadata based on brand configuration
 */
export function generateBrandedMetadata(override: Partial<Metadata> = {}): Metadata {
  const brand = getBrandConfig()

  const defaultTitle = brand.name
  const defaultDescription = `Build and deploy AI agents using our Figma-like canvas. Build, write evals, and deploy AI agent workflows that automate workflows and streamline your business processes.`

  return {
    title: {
      template: `%s | ${brand.name}`,
      default: defaultTitle,
    },
    description: defaultDescription,
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
    metadataBase: new URL(env.NEXT_PUBLIC_APP_URL),
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
      url: env.NEXT_PUBLIC_APP_URL,
      title: defaultTitle,
      description: defaultDescription,
      siteName: brand.name,
      images: [
        {
          url: brand.logoUrl || getAssetUrl('social/facebook.png'),
          width: 1200,
          height: 630,
          alt: brand.name,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: defaultTitle,
      description: defaultDescription,
      images: [brand.logoUrl || getAssetUrl('social/twitter.png')],
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
      'msapplication-TileColor': brand.primaryColor || '#ffffff',
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
      'Build and deploy AI agents using our Figma-like canvas. Build, write evals, and deploy AI agent workflows that automate workflows and streamline your business processes.',
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
