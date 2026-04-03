'use client'

import { useRouter } from 'next/navigation'
import { AUTH_SUBMIT_BTN } from '@/app/(auth)/components/auth-button-classes'
import { StatusPageLayout } from '@/app/(auth)/components/status-page-layout'

interface FormErrorStateProps {
  error: string
}

export function FormErrorState({ error }: FormErrorStateProps) {
  const router = useRouter()

  return (
    <StatusPageLayout title='Form Unavailable' description={error}>
      <button onClick={() => router.push('/workspace')} className={AUTH_SUBMIT_BTN}>
        Return to Workspace
      </button>
    </StatusPageLayout>
  )
}
