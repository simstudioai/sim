import type { ReactNode } from 'react'
import type { Viewport } from 'next'
import { DOCS_BASE_URL } from '@/lib/urls'

export default function RootLayout({ children }: { children: ReactNode }) {
  return children
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#000000',
}

export const metadata = {
  metadataBase: new URL(DOCS_BASE_URL),
  title: {
    default: 'Sim Documentation — The AI Workspace for Teams',
    template: '%s | Sim Docs',
  },
  description:
    'Documentation for Sim — the open-source AI workspace where teams build, deploy, and manage AI agents. Connect 1,000+ integrations and every major LLM.',
  applicationName: 'Sim Docs',
  generator: 'Next.js',
  referrer: 'origin-when-cross-origin' as const,
  keywords: [
    'AI workspace',
    'AI agent builder',
    'AI agents',
    'build AI agents',
    'open-source AI agents',
    'LLM orchestration',
    'AI integrations',
    'knowledge base',
    'AI automation',
    'visual workflow builder',
    'enterprise AI',
    'AI agent deployment',
    'AI tools',
  ],
  authors: [{ name: 'Sim Team', url: 'https://sim.ai' }],
  creator: 'Sim',
  publisher: 'Sim',
  category: 'Developer Tools',
  classification: 'Developer Documentation',
  manifest: '/favicon/site.webmanifest',
  icons: {
    apple: '/favicon/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Sim Docs',
  },
  formatDetection: {
    telephone: false,
  },
  other: {
    'msapplication-TileColor': '#000000',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    alternateLocale: ['es_ES', 'fr_FR', 'de_DE', 'ja_JP', 'zh_CN'],
    url: DOCS_BASE_URL,
    siteName: 'Sim Documentation',
    title: 'Sim Documentation — The AI Workspace for Teams',
    description:
      'Documentation for Sim — the open-source AI workspace where teams build, deploy, and manage AI agents. Connect 1,000+ integrations and every major LLM.',
    images: [
      {
        url: `${DOCS_BASE_URL}/api/og?title=Sim%20Documentation`,
        width: 1200,
        height: 630,
        alt: 'Sim Documentation',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Sim Documentation — The AI Workspace for Teams',
    description:
      'Documentation for Sim — the open-source AI workspace where teams build, deploy, and manage AI agents. Connect 1,000+ integrations and every major LLM.',
    creator: '@simdotai',
    site: '@simdotai',
    images: [`${DOCS_BASE_URL}/api/og?title=Sim%20Documentation`],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  alternates: {
    canonical: DOCS_BASE_URL,
    languages: {
      'x-default': DOCS_BASE_URL,
      en: DOCS_BASE_URL,
      es: `${DOCS_BASE_URL}/es`,
      fr: `${DOCS_BASE_URL}/fr`,
      de: `${DOCS_BASE_URL}/de`,
      ja: `${DOCS_BASE_URL}/ja`,
      zh: `${DOCS_BASE_URL}/zh`,
    },
  },
}
