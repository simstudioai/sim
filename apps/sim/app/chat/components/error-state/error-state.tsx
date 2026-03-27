'use client'

import { useRouter } from 'next/navigation'
import { AUTH_SUBMIT_BTN } from '@/app/(auth)/components/auth-button-classes'
import { StatusPageLayout } from '@/app/(auth)/components/status-page-layout'

interface ChatErrorStateProps {
  error: string
}

export function ChatErrorState({ error }: ChatErrorStateProps) {
  const router = useRouter()

  return (
    <StatusPageLayout title='Chat Unavailable' description={error}>
      <button onClick={() => router.push('/workspace')} className={AUTH_SUBMIT_BTN}>
        Return to Workspace
      </button>
    </StatusPageLayout>
  )
}
