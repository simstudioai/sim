import type { Metadata, Viewport } from 'next'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { PublicEnvScript } from 'next-runtime-env'
import { createLogger } from '@/lib/logs/console-logger'
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
  title: 'Sim Studio',
  description:
    'Build agents in seconds with a drag and drop workflow builder. Streamline your automation processes, boost productivity, and create custom workflows.',
  applicationName: 'Sim Studio',
  authors: [{ name: 'Simplicity' }],
  generator: 'Next.js',
  keywords: [
    'workflow automation',
    'drag and drop',
    'agents',
    'Simplicity',
    'workflow builder',
    'automation tools',
  ],
  referrer: 'origin-when-cross-origin',
  creator: 'Simplicity',
  publisher: 'Simplicity',
  metadataBase: new URL('https://simstudio.ai'), // Replace with your actual domain
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
    title: 'Sim Studio | Create Workflows with Drag and Drop Agents',
    description:
      'Build agents in seconds with a drag and drop workflow builder. Streamline your automation processes, boost productivity, and create custom workflows.',
    siteName: 'Sim Studio',
    images: [
      {
        url: 'https://simstudio.ai/social/facebook.png',
        width: 1200,
        height: 600,
        alt: 'Sim Studio',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Sim Studio',
    description:
      'Build agents in seconds with a drag and drop workflow builder. Streamline your automation processes, boost productivity, and create custom workflows.',
    images: ['https://simstudio.ai/social/twitter.png'],
    creator: '@simplicity',
    site: '@simstudio',
  },
  manifest: '/favicon/site.webmanifest',
  icons: {
    icon: [
      { url: '/favicon/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon/favicon-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/favicon/favicon-512x512.png', sizes: '512x512', type: 'image/png' },
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
  other: {
    'apple-mobile-web-app-capable': 'yes',
    'mobile-web-app-capable': 'yes',
    'msapplication-TileColor': '#ffffff',
    'msapplication-config': '/favicon/browserconfig.xml',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Additional meta tags for sharing */}
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="600" />
        <meta name="twitter:image:width" content="1200" />
        <meta name="twitter:image:height" content="675" />
        <meta name="twitter:image:alt" content="Sim Studio" />
        <meta name="twitter:image" content="https://simstudio.ai/social/twitter.png" />
        <meta name="twitter:url" content="https://simstudio.ai" />
        <meta property="og:image:alt" content="Sim Studio" />
        <link rel="image_src" href="https://simstudio.ai/social/facebook.png" />
        {/* Instagram image meta */}
        <meta property="og:image" content="https://simstudio.ai/social/instagram.png" />
        <meta property="og:image:width" content="1080" />
        <meta property="og:image:height" content="1080" />

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
