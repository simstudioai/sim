import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import type { Metadata, Viewport } from 'next'
import { PublicEnvScript } from 'next-runtime-env'
import { BrandedLayout } from '@/components/branded-layout'
import { generateBrandedMetadata, generateStructuredData } from '@/lib/branding/metadata'
import { env } from '@/lib/env'
import { isHosted } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import { getAssetUrl } from '@/lib/utils'
import { TelemetryConsentDialog } from '@/app/telemetry-consent-dialog'
import '@/app/globals.css'

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
  themeColor: '#ffffff',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

// Generate dynamic metadata based on brand configuration
export const metadata: Metadata = generateBrandedMetadata()

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const structuredData = generateStructuredData()

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

        {/* Meta tags for better SEO */}
        <meta name='theme-color' content='#ffffff' />
        <meta name='color-scheme' content='light' />
        <meta name='format-detection' content='telephone=no' />
        <meta httpEquiv='x-ua-compatible' content='ie=edge' />

        {/* Additional Open Graph tags */}
        <meta property='og:image:width' content='1200' />
        <meta property='og:image:height' content='630' />
        <meta
          property='og:image:alt'
          content='Sim - AI Agent Builder with Visual Canvas Interface'
        />
        <meta property='og:site_name' content='Sim' />
        <meta property='og:locale' content='en_US' />

        {/* Twitter Card tags */}
        <meta name='twitter:image:width' content='1200' />
        <meta name='twitter:image:height' content='675' />
        <meta name='twitter:image:alt' content='Sim - AI Agent Builder' />
        <meta name='twitter:url' content='https://sim.ai' />
        <meta name='twitter:domain' content='sim.ai' />

        {/* Additional image sources */}
        <link rel='image_src' href={getAssetUrl('social/facebook.png')} />

        <PublicEnvScript />

        {/* RB2B Script - Only load on hosted version */}
        {isHosted && env.NEXT_PUBLIC_RB2B_KEY && (
          <script
            dangerouslySetInnerHTML={{
              __html: `!function () {var reb2b = window.reb2b = window.reb2b || [];if (reb2b.invoked) return;reb2b.invoked = true;reb2b.methods = ["identify", "collect"];reb2b.factory = function (method) {return function () {var args = Array.prototype.slice.call(arguments);args.unshift(method);reb2b.push(args);return reb2b;};};for (var i = 0; i < reb2b.methods.length; i++) {var key = reb2b.methods[i];reb2b[key] = reb2b.factory(key);}reb2b.load = function (key) {var script = document.createElement("script");script.type = "text/javascript";script.async = true;script.src = "https://b2bjsstore.s3.us-west-2.amazonaws.com/b/" + key + "/${env.NEXT_PUBLIC_RB2B_KEY}.js.gz";var first = document.getElementsByTagName("script")[0];first.parentNode.insertBefore(script, first);};reb2b.SNIPPET_VERSION = "1.0.1";reb2b.load("${env.NEXT_PUBLIC_RB2B_KEY}");}();`,
            }}
          />
        )}
      </head>
      <body suppressHydrationWarning>
        <BrandedLayout>
          <ZoomPrevention />
          <TelemetryConsentDialog />
          {children}
          {isHosted && (
            <>
              <SpeedInsights />
              <Analytics />
            </>
          )}
        </BrandedLayout>
      </body>
    </html>
  )
}
