import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { PublicEnvScript } from 'next-runtime-env'
import { BrandedLayout } from '@/components/branded-layout'
import { generateThemeCSS } from '@/lib/branding/inject-theme'
import { generateBrandedMetadata, generateStructuredData } from '@/lib/branding/metadata'
import { isHosted } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import '@/app/globals.css'

import { SessionProvider } from '@/lib/session/session-context'
import { ConditionalThemeProvider } from '@/app/conditional-theme-provider'
import { ZoomPrevention } from '@/app/zoom-prevention'

const logger = createLogger('RootLayout')

const BROWSER_EXTENSION_ATTRIBUTES = [
  'data-new-gr-c-s-check-loaded',
  'data-gr-ext-installed',
  'data-gr-ext-disabled',
  'data-grammarly',
  'data-fgm',
  'data-lt-installed',
]

if (typeof window !== 'undefined') {
  const originalError = console.error
  console.error = (...args) => {
    if (args[0].includes('Hydration')) {
      const isExtensionError = BROWSER_EXTENSION_ATTRIBUTES.some((attr) =>
        args.some((arg) => typeof arg === 'string' && arg.includes(attr))
      )

      if (!isExtensionError) {
        logger.error('Hydration Error', {
          details: args,
          componentStack: args.find(
            (arg) => typeof arg === 'string' && arg.includes('component stack')
          ),
        })
      }
    }
    originalError.apply(console, args)
  }
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0c0c' },
  ],
}

// Generate dynamic metadata based on brand configuration
export const metadata: Metadata = generateBrandedMetadata()

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const structuredData = generateStructuredData()
  const themeCSS = generateThemeCSS()

  return (
    <html lang='en' suppressHydrationWarning>
      <head>
        {/* Structured Data for SEO */}
        <script
          type='application/ld+json'
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(structuredData),
          }}
        />

        {/* Theme CSS Override */}
        {themeCSS && (
          <style
            id='theme-override'
            dangerouslySetInnerHTML={{
              __html: themeCSS,
            }}
          />
        )}

        {/* Basic head hints that are not covered by the Metadata API */}
        <meta name='color-scheme' content='light dark' />
        <meta name='format-detection' content='telephone=no' />
        <meta httpEquiv='x-ua-compatible' content='ie=edge' />

        <PublicEnvScript />
      </head>
      <body suppressHydrationWarning>
        <ConditionalThemeProvider>
          <SessionProvider>
            <BrandedLayout>
              <ZoomPrevention />
              {children}
              {isHosted && (
                <>
                  <Analytics />
                </>
              )}
            </BrandedLayout>
          </SessionProvider>
        </ConditionalThemeProvider>
      </body>
    </html>
  )
}
