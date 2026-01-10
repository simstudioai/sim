'use client'

import { useRouter } from 'next/navigation'
import { BrandedButton } from '@/app/(auth)/components/branded-button'
import { StatusPageLayout } from '@/app/(auth)/components/status-page-layout'

interface FormErrorStateProps {
  error: string
}

export function FormErrorState({ error }: FormErrorStateProps) {
  const router = useRouter()

  return (
    <StatusPageLayout title='Form Unavailable' description={error} hideNav>
      <BrandedButton onClick={() => router.push('/workspace')}>Return to Workspace</BrandedButton>
    </StatusPageLayout>
  )
}
