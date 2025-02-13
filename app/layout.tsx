import type { Metadata } from 'next'
import './globals.css'
import { ThemeProvider } from './w/providers/theme-provider'
import { ZoomPrevention } from './zoom-prevention'

export const metadata: Metadata = {
  title: 'Sim Studio',
  description: 'Drag and drop agents to create workflows. Powered by Simplicity',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
        />
      </head>
      <body>
        <ThemeProvider>
          <ZoomPrevention />
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
