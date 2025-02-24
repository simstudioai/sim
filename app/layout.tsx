import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { ZoomPrevention } from './zoom-prevention'

// Initialize the Inter font
const inter = Inter({ subsets: ['latin'] })

// Add browser extension attributes that we want to ignore
const BROWSER_EXTENSION_ATTRIBUTES = [
  'data-new-gr-c-s-check-loaded',
  'data-gr-ext-installed',
  'data-gr-ext-disabled',
  'data-grammarly',
  'data-fgm',
  'data-lt-installed',
  // Add other known extension attributes here
]

if (typeof window !== 'undefined') {
  const originalError = console.error
  console.error = (...args) => {
    // Check if it's a hydration error
    if (args[0].includes('Hydration')) {
      // Check if the error is related to browser extensions
      const isExtensionError = BROWSER_EXTENSION_ATTRIBUTES.some((attr) =>
        args.some((arg) => typeof arg === 'string' && arg.includes(attr))
      )

      if (!isExtensionError) {
        // Log non-extension hydration errors with more detail
        console.group('Hydration Error')
        console.log('Error Details:', args)
        console.log(
          'Component Stack:',
          args.find((arg) => typeof arg === 'string' && arg.includes('component stack'))
        )
        console.groupEnd()
      }
    }
    originalError.apply(console, args)
  }
}

export const viewport: Viewport = {
  themeColor: '#ffffff',
}

export const metadata: Metadata = {
  title: 'Sim Studio',
  description: 'Drag and drop agents to create workflows. Powered by Simplicity',
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
    title: 'Sim Studio',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.className}>
      <head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
        />
      </head>
      <body suppressHydrationWarning>
        <ZoomPrevention />
        {children}
      </body>
    </html>
  )
}
