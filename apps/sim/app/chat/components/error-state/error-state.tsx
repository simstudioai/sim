'use client'

import { useRouter } from 'next/navigation'
import { AUTH_SUBMIT_BTN } from '@/app/(auth)/components/auth-button-classes'
import { StatusPageLayout } from '@/app/(auth)/components/status-page-layout'
import { useTranslations } from 'next-intl'

interface ChatErrorStateProps {
  error: string
}

export function ChatErrorState({ error }: ChatErrorStateProps) {
  const t = useTranslations('auto')
  const router = useRouter()

  return (
    <StatusPageLayout title={t('chat_unavailable')} description={error}>
      <button onClick={() => router.push('/workspace')} className={AUTH_SUBMIT_BTN}>
        {t('return_to_workspace')}
      </button>
    </StatusPageLayout>
  )
}
