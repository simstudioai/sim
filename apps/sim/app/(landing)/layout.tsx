import type { Metadata } from 'next'

export const metadata: Metadata = {
  metadataBase: new URL('https://sim.ai'),
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml', sizes: 'any' }],
    apple: '/favicon/apple-touch-icon.png',
  },
  other: {
    'msapplication-TileColor': '#000000',
    'theme-color': '#000000',
  },
}

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return children
}
