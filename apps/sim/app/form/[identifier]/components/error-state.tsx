'use client'

import { useRouter } from 'next/navigation'
import { CTAButton } from '@/app/(auth)/components/cta-button'
import { StatusPageLayout } from '@/app/(auth)/components/status-page-layout'

interface FormErrorStateProps {
  error: string
}

export function FormErrorState({ error }: FormErrorStateProps) {
  const router = useRouter()

  return (
    <StatusPageLayout title='Form Unavailable' description={error} hideNav>
      <CTAButton onClick={() => router.push('/workspace')}>Return to Workspace</CTAButton>
    </StatusPageLayout>
  )
}
