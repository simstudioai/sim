import type { ReactNode } from 'react'
import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import { DocsThemeProvider } from '@/components/docs/theme'
import { serializeJsonLd } from '@/lib/json-ld'
import { DOCS_BASE_URL, SIM_SITE_URL } from '@/lib/urls'
import './global.css'

const geist = localFont({
  src: './fonts/geist-variable.woff2',
  variable: '--font-geist-sans',
  display: 'swap',
  weight: '100 900',
})
const mono = localFont({
  src: './fonts/geist-mono-variable.woff2',
  variable: '--font-geist-mono',
  display: 'swap',
  weight: '100 900',
  preload: false,
})
const description =
  'Guides and API references for Sim, the open-source AI workspace. Learn how to use Chat, build workflows, manage data, and operate your deployment.'

interface RootLayoutProps {
  children: ReactNode
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang='en' className={`${geist.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className='docs-root flex min-h-dvh flex-col bg-[var(--docs-canvas)] font-sans antialiased'>
        <script
          type='application/ld+json'
          dangerouslySetInnerHTML={{
            __html: serializeJsonLd({
              '@context': 'https://schema.org',
              '@type': 'WebSite',
              name: 'Sim Documentation',
              description,
              url: DOCS_BASE_URL,
              inLanguage: 'en',
              publisher: { '@type': 'Organization', name: 'Sim', url: SIM_SITE_URL },
            }),
          }}
        />
        <a
          href='#main-content'
          className='sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-lg focus:bg-[var(--docs-canvas)] focus:px-4 focus:py-2'
        >
          Skip to content
        </a>
        <DocsThemeProvider>{children}</DocsThemeProvider>
      </body>
    </html>
  )
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#1b1b1b' },
  ],
}

export const metadata: Metadata = {
  metadataBase: new URL(DOCS_BASE_URL),
  title: { default: 'Sim documentation', template: '%s | Sim Docs' },
  description,
  applicationName: 'Sim Docs',
  authors: [{ name: 'Sim', url: SIM_SITE_URL }],
  publisher: 'Sim',
  manifest: '/favicon/site.webmanifest',
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml', sizes: 'any' }],
    apple: '/favicon/apple-touch-icon.png',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    siteName: 'Sim Documentation',
    title: 'Sim documentation',
    description,
    images: [
      {
        url: '/api/og?title=Sim%20Documentation',
        width: 1200,
        height: 675,
        alt: 'Sim Documentation',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Sim documentation',
    description,
    site: '@simdotai',
    images: ['/api/og?title=Sim%20Documentation'],
  },
  robots: {
    googleBot: { 'max-video-preview': -1, 'max-image-preview': 'large', 'max-snippet': -1 },
  },
  alternates: {
    types: { 'text/plain': [{ url: '/llms.txt', title: 'Documentation index for agents' }] },
  },
}
