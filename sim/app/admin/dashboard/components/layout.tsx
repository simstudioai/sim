'use client'

import { ReactNode } from 'react'
import PasswordAuth from '../../password-auth'

interface DashboardLayoutProps {
  children: ReactNode
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
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