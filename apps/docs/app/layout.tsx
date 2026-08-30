import type { ReactNode } from 'react'
import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { RootProvider } from 'fumadocs-ui/provider/next'
import type { Viewport } from 'next'
import { Inter } from 'next/font/google'
import { ThemeProvider } from 'next-themes'
import {
  SidebarFolder,
  SidebarItem,
  SidebarSeparator,
} from '@/components/docs-layout/sidebar-components'
import { Footer } from '@/components/footer/footer'
import { Navbar } from '@/components/navbar/navbar'
import { SimWordmark } from '@/components/ui/sim-logo'
import { serializeJsonLd } from '@/lib/json-ld'
import { source } from '@/lib/source'
import { DOCS_BASE_URL } from '@/lib/urls'
import { season } from '@/app/fonts/season'
import './global.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-geist-sans',
  display: 'swap',
})

const structuredData = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'Sim Documentation',
  description:
    'Documentation for Sim — the open-source AI workspace where teams build, deploy, and manage AI agents. Connect 1,000+ integrations and every major LLM.',
  url: DOCS_BASE_URL,
  publisher: {
    '@type': 'Organization',
    name: 'Sim',
    url: 'https://sim.ai',
    logo: {
      '@type': 'ImageObject',
      url: `${DOCS_BASE_URL}/static/logo.png`,
    },
  },
  inLanguage: 'en',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang='en' className={`${inter.variable} ${season.variable}`} suppressHydrationWarning>
      <head>
        <script
          id='website-json-ld'
          type='application/ld+json'
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }}
        />
      </head>
      <body className='flex min-h-screen flex-col font-sans'>
        <ThemeProvider
          attribute='class'
          defaultTheme='system'
          enableSystem
          disableTransitionOnChange
        >
          <RootProvider theme={{ enabled: false }}>
            <Navbar />
            <DocsLayout
              tree={source.pageTree}
              nav={{
                title: <SimWordmark className='h-[18px]' />,
              }}
              sidebar={{
                tabs: false,
                defaultOpenLevel: 0,
                collapsible: false,
                footer: null,
                banner: null,
                prefetch: false,
                components: {
                  Item: SidebarItem,
                  Folder: SidebarFolder,
                  Separator: SidebarSeparator,
                },
              }}
              containerProps={{
                className: '!pt-0',
              }}
            >
              {children}
            </DocsLayout>
            <Footer />
          </RootProvider>
        </ThemeProvider>
      </body>
    </html>
  )
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
    icon: [{ url: '/icon.svg', type: 'image/svg+xml', sizes: 'any' }],
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
    url: DOCS_BASE_URL,
    siteName: 'Sim Documentation',
    title: 'Sim Documentation — The AI Workspace for Teams',
    description:
      'Documentation for Sim — the open-source AI workspace where teams build, deploy, and manage AI agents. Connect 1,000+ integrations and every major LLM.',
    images: [
      {
        url: `${DOCS_BASE_URL}/api/og?title=Sim%20Documentation`,
        width: 1200,
        height: 675,
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
  },
}
