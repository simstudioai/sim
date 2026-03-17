import type { Metadata } from 'next'
import AuthLayoutClient from '@/app/(auth)/auth-layout-client'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthLayoutClient>{children}</AuthLayoutClient>
}
