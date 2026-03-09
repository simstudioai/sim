'use client'

import { useRouter } from 'next/navigation'
import { BrandedButton } from '@/app/(auth)/components/branded-button'
import { StatusPageLayout } from '@/app/(auth)/components/status-page-layout'

export default function NotFound() {
  const router = useRouter()

  return (
    <StatusPageLayout
      title='Page Not Found'
      description="The page you're looking for doesn't exist or has been moved."
    >
      <BrandedButton onClick={() => router.push('/')}>Return to Home</BrandedButton>
    </StatusPageLayout>
  )
}
