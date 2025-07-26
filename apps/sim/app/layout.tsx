import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import type { Metadata, Viewport } from 'next'
import { PublicEnvScript } from 'next-runtime-env'
import { createLogger } from '@/lib/logs/console/logger'
import { TelemetryConsentDialog } from '@/app/telemetry-consent-dialog'
import './globals.css'

import { ZoomPrevention } from './zoom-prevention'

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

export const metadata: Metadata = {
  title: {
    template: '',
    default: 'Sim Studio',
  },
  description:
    'Build and deploy AI agents using our Figma-like canvas. Build, write evals, and deploy AI agent workflows that automate workflows and streamline your business processes.',
  applicationName: 'Sim Studio',
  authors: [{ name: 'Sim Studio' }],
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
  creator: 'Sim Studio',
  publisher: 'Sim Studio',
  metadataBase: new URL('https://simstudio.ai'),
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
    url: 'https://simstudio.ai',
    title: 'Sim Studio',
    description:
      'Build and deploy AI agents using our Figma-like canvas. Build, write evals, and deploy AI agent workflows that automate workflows and streamline your business processes.',
    siteName: 'Sim Studio',
    images: [
      {
        url: 'https://simstudio.ai/social/facebook.png',
        width: 1200,
        height: 630,
        alt: 'Sim Studio',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Sim Studio',
    description:
      'Build and deploy AI agents using our Figma-like canvas. Build, write evals, and deploy AI agent workflows that automate workflows and streamline your business processes.',
    images: ['https://simstudio.ai/social/twitter.png'],
    creator: '@simstudioai',
    site: '@simstudioai',
  },
  manifest: '/favicon/site.webmanifest',
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
      { url: '/sim.png', sizes: 'any', type: 'image/png' },
    ],
    apple: '/favicon/apple-touch-icon.png',
    shortcut: '/favicon/favicon.ico',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Sim Studio',
  },
  formatDetection: {
    telephone: false,
  },
  category: 'technology',
  other: {
    'apple-mobile-web-app-capable': 'yes',
    'mobile-web-app-capable': 'yes',
    'msapplication-TileColor': '#ffffff',
    'msapplication-config': '/favicon/browserconfig.xml',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang='en' suppressHydrationWarning>
      <head>
        {/* Structured Data for SEO */}
        <script
          type='application/ld+json'
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'SoftwareApplication',
              name: 'Sim Studio',
              description:
                'Build and deploy AI agents using our Figma-like canvas. Build, write evals, and deploy AI agent workflows that automate workflows and streamline your business processes.',
              url: 'https://simstudio.ai',
              applicationCategory: 'BusinessApplication',
              operatingSystem: 'Web Browser',
              offers: {
                '@type': 'Offer',
                category: 'SaaS',
              },
              creator: {
                '@type': 'Organization',
                name: 'Sim Studio',
                url: 'https://simstudio.ai',
              },
              featureList: [
                'Visual AI Agent Builder',
                'Workflow Canvas Interface',
                'AI Agent Automation',
                'Custom AI Workflows',
              ],
            }),
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
          content='Sim Studio - AI Agent Builder with Visual Canvas Interface'
        />
        <meta property='og:site_name' content='Sim Studio' />
        <meta property='og:locale' content='en_US' />

        {/* Twitter Card tags */}
        <meta name='twitter:image:width' content='1200' />
        <meta name='twitter:image:height' content='675' />
        <meta name='twitter:image:alt' content='Sim Studio - AI Agent Builder' />
        <meta name='twitter:url' content='https://simstudio.ai' />
        <meta name='twitter:domain' content='simstudio.ai' />

        {/* Additional image sources */}
        <link rel='image_src' href='https://simstudio.ai/social/facebook.png' />

        <PublicEnvScript />
      </head>
      <body suppressHydrationWarning>
        <ZoomPrevention />
        <TelemetryConsentDialog />
        {children}
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  )
}
