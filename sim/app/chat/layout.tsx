import type { Metadata } from 'next'
import { ZoomPrevention } from '@/app/zoom-prevention'

export const metadata: Metadata = {
  title: 'Chat',
  description: 'Sim Studio Chat',
}

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        {children}
      </body>
    </html>
  )
}  