'use client'

import { useTranslations } from 'next-intl'
import { type ErrorBoundaryProps, ErrorState } from '@/app/workspace/[workspaceId]/components'

export default function LogsError({ error, reset }: ErrorBoundaryProps) {
  const t = useTranslations('auto')
  return (
    <ErrorState
      error={error}
      reset={reset}
      title={t('failed_to_load_logs')}
      description={t('something_went_wrong_while_loading_the')}
      loggerName='LogsError'
    />
  )
}
