'use client'

import { type ErrorBoundaryProps, ErrorState } from '@/app/workspace/[workspaceId]/components'
import { useTranslations } from 'next-intl'

export default function HomeError({ error, reset }: ErrorBoundaryProps) {
  const t = useTranslations('auto')
  return (
    <ErrorState
      error={error}
      reset={reset}
      title={t('failed_to_load_home')}
      description={t('something_went_wrong_while_loading_your')}
      loggerName='HomeError'
    />
  )
}
