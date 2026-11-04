import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import '@/platform/design-system/styles/globals.css'

export const metadata: Metadata = {
  title: 'Platform design system · Sim',
  description: 'The component workbench for Sim Platform.',
  robots: { index: false, follow: false },
}

interface RootLayoutProps {
  children: ReactNode
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang='en'>
      <body>{children}</body>
    </html>
  )
}
