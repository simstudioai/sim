import type { ReactNode } from 'react'
import { DesktopTitleBarLane } from '@/app/_shell/desktop-title-bar'

interface AccessRequestsLayoutProps {
  children: ReactNode
}

export default function AccessRequestsLayout({ children }: AccessRequestsLayoutProps) {
  return (
    <div className='desktop-title-bar-page flex flex-col bg-[var(--bg)]'>
      <DesktopTitleBarLane />
      {children}
    </div>
  )
}
