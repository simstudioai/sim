'use client'

import { ReactNode } from 'react'
import { useSession } from '../../../lib/auth-client'
import PasswordAuth from '../password-auth'

interface DashboardLayoutProps {
  children: ReactNode
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const { data: session } = useSession()

  return (
    <PasswordAuth>
      <div className="min-h-screen bg-gray-100">
        <div className="flex-1">
          {children}
        </div>
      </div>
    </PasswordAuth>
  )
} 