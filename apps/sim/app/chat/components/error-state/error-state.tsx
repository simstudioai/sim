'use client'

import { useRouter } from 'next/navigation'
import { CTAButton } from '@/app/(auth)/components/cta-button'
import { StatusPageLayout } from '@/app/(auth)/components/status-page-layout'

interface ChatErrorStateProps {
  error: string
  starCount: string
}

export function ChatErrorState({ error, starCount: _starCount }: ChatErrorStateProps) {
  const router = useRouter()

  return (
    <StatusPageLayout title='Chat Unavailable' description={error}>
      <CTAButton onClick={() => router.push('/workspace')}>Return to Workspace</CTAButton>
    </StatusPageLayout>
  )
}
