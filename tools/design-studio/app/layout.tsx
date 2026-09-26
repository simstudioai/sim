import type { ReactNode } from 'react'
import '@/app/_styles/globals.css'

export default function StudioLayout({ children }: { children: ReactNode }) {
  return (
    <html lang='en'>
      <body className='min-h-screen bg-[var(--bg)] text-[var(--text-primary)]'>{children}</body>
    </html>
  )
}
