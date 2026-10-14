import type { ReactNode } from 'react'
import { defaultTranslations as openApiTranslations } from 'fumadocs-openapi/i18n'
import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { SidebarProvider, SidebarTrigger, useSidebar } from 'fumadocs-ui/layouts/docs/slots/sidebar'
import { RootProvider } from 'fumadocs-ui/provider/next'
import type { Viewport } from 'next'
import { Inter } from 'next/font/google'
import { ThemeProvider } from 'next-themes'
import { DocsSidebar } from '@/components/docs-layout/docs-sidebar'
import { Footer } from '@/components/footer/footer'
import { Navbar } from '@/components/navbar/navbar'
import { SimWordmark } from '@/components/ui/sim-logo'
import { serializeJsonLd } from '@/lib/json-ld'
import { source } from '@/lib/source'
import { DOCS_BASE_URL, SIM_SITE_URL } from '@/lib/urls'
import { season } from '@/app/fonts/season'
import './global.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-geist-sans',
  display: 'swap',
})

const DOCUMENTATION_DESCRIPTION =
  'Guides and API references for Sim, the open-source AI workspace. Learn how to use Chat, build workflows, manage data, and operate your deployment.'

const OPENAPI_TRANSLATIONS = {
  ...openApiTranslations,
  titleRequestTabs: 'Request examples',
  queryParameters: 'Query parameters',
  pathParameters: 'Path parameters',
  headerParameters: 'Header parameters',
  cookieParameters: 'Cookie parameters',
  titleRequestBody: 'Request body',
  titleResponseBody: 'Response body',
  typeScriptDefinitions: 'TypeScript definitions',
  schemaMultipleOf: 'Multiple of',
  closeJsonEditor: 'Close JSON editor',
  openJsonEditor: 'Open JSON editor',
  accessToken: 'Access token',
  statusBadRequest: 'Bad request',
  statusNotFound: 'Not found',
  statusInternalServerError: 'Internal server error',
  statusClientError: 'Client error',
  resourceOwnerPassword: 'Resource owner password flow',
  clientCredentials: 'Client credentials',
  deviceAuthorization: 'Device authorization',
  clientSecret: 'Client secret',
  serverUrlFieldPlaceholder: 'Enter value',
  schemaShowArray: 'Array item',
  schemaHideArray: 'Array item',
  schemaFilterPropertiesPlaceholder: 'Filter properties',
  playgroundShowProperty: 'Show property',
  playgroundPropertyPlaceholder: 'Enter property name',
  playgroundNewItem: 'New item',
  playgroundRemoveItem: 'Remove item',
}

const structuredData = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'Sim Documentation',
  description: DOCUMENTATION_DESCRIPTION,
  url: DOCS_BASE_URL,
  publisher: {
    '@type': 'Organization',
    '@id': `${SIM_SITE_URL}#organization`,
    name: 'Sim',
    url: SIM_SITE_URL,
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
          <RootProvider
            theme={{ enabled: false }}
            i18n={{ translations: { openapi: OPENAPI_TRANSLATIONS } }}
          >
            <a
              href='#nd-page'
              className='sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-lg focus:bg-[var(--bg)] focus:px-4 focus:py-2 focus:text-[var(--text-primary)]'
            >
              Skip to content
            </a>
            <Navbar />
            <DocsLayout
              tree={source.pageTree}
              nav={{
                title: (
                  <>
                    <SimWordmark className='h-[18px]' />
                    <span className='sr-only'>Sim documentation home</span>
                  </>
                ),
              }}
              sidebar={{
                tabs: false,
                defaultOpenLevel: 0,
                collapsible: false,
                footer: null,
                banner: null,
                prefetch: false,
              }}
              slots={{
                sidebar: {
                  provider: SidebarProvider,
                  root: DocsSidebar,
                  trigger: SidebarTrigger,
                  useSidebar,
                },
              }}
              containerProps={{
                className:
                  '!pt-0 [--text-muted:var(--text-secondary)] [--color-fd-muted-foreground:var(--text-secondary)]',
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
    default: 'Sim documentation',
    template: '%s | Sim Docs',
  },
  description: DOCUMENTATION_DESCRIPTION,
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
  authors: [{ name: 'Sim Team', url: SIM_SITE_URL }],
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
    title: 'Sim documentation',
    description: DOCUMENTATION_DESCRIPTION,
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
    title: 'Sim documentation',
    description: DOCUMENTATION_DESCRIPTION,
    creator: '@simdotai',
    site: '@simdotai',
    images: [`${DOCS_BASE_URL}/api/og?title=Sim%20Documentation`],
  },
  /**
   * Preview hints only. Indexable is the default, and asserting `index` or a
   * root canonical here would also reach the not-found page, contradicting
   * the `noindex` Next adds there; each doc page sets its own canonical.
   */
  robots: {
    googleBot: {
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
}
