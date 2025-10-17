import type { ReactNode } from 'react'

export default function RootLayout({ children }: { children: ReactNode }) {
  return children
}

export const metadata = {
  metadataBase: new URL('https://docs.sim.ai'),
  title: {
    default: 'Sim Documentation - Visual Workflow Builder for AI Applications',
    template: '%s',
  },
  description:
    'Comprehensive documentation for Sim - the visual workflow builder for AI applications. Create powerful AI agents, automation workflows, and data processing pipelines by connecting blocks on a canvas—no coding required.',
  keywords: [
    'AI workflow builder',
    'visual workflow editor',
    'AI automation',
    'workflow automation',
    'AI agents',
    'no-code AI',
    'drag and drop workflows',
    'AI integrations',
    'workflow canvas',
    'AI Agent Workflow Builder',
    'workflow orchestration',
    'agent builder',
    'AI workflow automation',
    'visual programming',
  ],
  authors: [{ name: 'Sim Team', url: 'https://sim.ai' }],
  creator: 'Sim',
  publisher: 'Sim',
  category: 'Developer Tools',
  classification: 'Developer Documentation',
  manifest: '/favicon/site.webmanifest',
  icons: {
    icon: [
      { url: '/favicon/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: '/favicon/apple-touch-icon.png',
    shortcut: '/favicon/favicon.ico',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Sim Docs',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    alternateLocale: ['es_ES', 'fr_FR', 'de_DE', 'ja_JP', 'zh_CN'],
    url: 'https://docs.sim.ai',
    siteName: 'Sim Documentation',
    title: 'Sim Documentation - Visual Workflow Builder for AI Applications',
    description:
      'Comprehensive documentation for Sim - the visual workflow builder for AI applications. Create powerful AI agents, automation workflows, and data processing pipelines.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Sim Documentation - Visual Workflow Builder for AI Applications',
    description:
      'Comprehensive documentation for Sim - the visual workflow builder for AI applications.',
    creator: '@simdotai',
    site: '@simdotai',
    images: ['/og-image.png'],
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
