import type { ReactNode } from 'react'
import type { Viewport } from 'next'

export default function RootLayout({ children }: { children: ReactNode }) {
  return children
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0c0c' },
  ],
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
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml', sizes: 'any' },
      { url: '/favicon/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/favicon/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/favicon/apple-touch-icon.png',
    shortcut: '/icon.svg',
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
    'apple-mobile-web-app-capable': 'yes',
    'mobile-web-app-capable': 'yes',
    'msapplication-TileColor': '#33C482',
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
