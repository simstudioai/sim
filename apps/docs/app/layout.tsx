import type { ReactNode } from 'react'
import type { Viewport } from 'next'

export default function RootLayout({ children }: { children: ReactNode }) {
  return children
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#000000',
}

export const metadata = {
  metadataBase: new URL('https://docs.sim.ai'),
  title: {
    default: 'Sim Documentation — Build AI Agents & Run Your Agentic Workforce',
    template: '%s | Sim Docs',
  },
  description:
    'Documentation for Sim — the open-source platform to build AI agents and run your agentic workforce. Connect 1,000+ integrations and LLMs to deploy and orchestrate agentic workflows.',
  applicationName: 'Sim Docs',
  generator: 'Next.js',
  referrer: 'origin-when-cross-origin' as const,
  keywords: [
    'AI agents',
    'agentic workforce',
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
    url: 'https://docs.sim.ai',
    siteName: 'Sim Documentation',
    title: 'Sim Documentation — Build AI Agents & Run Your Agentic Workforce',
    description:
      'Documentation for Sim — the open-source platform to build AI agents and run your agentic workforce. Connect 1,000+ integrations and LLMs to deploy and orchestrate agentic workflows.',
    images: [
      {
        url: 'https://docs.sim.ai/api/og?title=Sim%20Documentation',
        width: 1200,
        height: 630,
        alt: 'Sim Documentation',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Sim Documentation — Build AI Agents & Run Your Agentic Workforce',
    description:
      'Documentation for Sim — the open-source platform to build AI agents and run your agentic workforce. Connect 1,000+ integrations and LLMs to deploy and orchestrate agentic workflows.',
    creator: '@simdotai',
    site: '@simdotai',
    images: ['https://docs.sim.ai/api/og?title=Sim%20Documentation'],
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
    canonical: 'https://docs.sim.ai',
    languages: {
      'x-default': 'https://docs.sim.ai',
      en: 'https://docs.sim.ai',
      es: 'https://docs.sim.ai/es',
      fr: 'https://docs.sim.ai/fr',
      de: 'https://docs.sim.ai/de',
      ja: 'https://docs.sim.ai/ja',
      zh: 'https://docs.sim.ai/zh',
    },
  },
}
