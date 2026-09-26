import type { ReactNode } from 'react'
import { season } from '@/app/_styles/fonts/season/season'
import '@studio/app/studio.css'

export default function StudioLayout({ children }: { children: ReactNode }) {
  return (
    <html lang='en'>
      <body
        className={`${season.variable} min-h-screen bg-[var(--bg)] font-season text-[var(--text-primary)]`}
      >
        {children}
      </body>
    </html>
  )
}
