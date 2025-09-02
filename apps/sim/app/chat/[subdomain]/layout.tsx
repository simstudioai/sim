'use client'

import { ThemeProvider } from 'next-themes'
import './chat.css'

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute='class'
      forcedTheme='light'
      enableSystem={false}
      disableTransitionOnChange
    >
      <div className='light chat-light-wrapper' style={{ colorScheme: 'light' }}>
        {children}
      </div>
    </ThemeProvider>
  )
}
