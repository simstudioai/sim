'use client'

import { usePathname } from 'next/navigation'
import { DesktopTitleBarController } from '@/app/_shell/desktop-title-bar'
import { AuthShell } from '@/app/(auth)/components'

export default function AuthLayoutClient({ children }: { children: React.ReactNode }) {
  const isLogin = usePathname() === '/login'

  return (
    <>
      {isLogin && <DesktopTitleBarController />}
      <AuthShell reserveDesktopTitleBar={isLogin}>{children}</AuthShell>
    </>
  )
}
