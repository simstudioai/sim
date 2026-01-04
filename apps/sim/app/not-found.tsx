'use client'

import { useRouter } from 'next/navigation'
import { CTAButton } from '@/app/(auth)/components/cta-button'
import { StatusPageLayout } from '@/app/(auth)/components/status-page-layout'

export default function NotFound() {
  const router = useRouter()

  return (
    <StatusPageLayout
      title='Page Not Found'
      description="The page you're looking for doesn't exist or has been moved."
    >
      <CTAButton onClick={() => router.push('/')}>Return to Home</CTAButton>
    </StatusPageLayout>
  )
}
