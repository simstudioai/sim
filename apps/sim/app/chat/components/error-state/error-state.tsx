'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { AUTH_SUBMIT_BTN } from '@/app/(auth)/components/auth-button-classes'
import { StatusPageLayout } from '@/app/(auth)/components/status-page-layout'

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
