'use client'

import { type ErrorBoundaryProps, ErrorState } from '@/app/workspace/[workspaceId]/components'
import { useTranslations } from 'next-intl'

export default function ScheduledTasksError({ error, reset }: ErrorBoundaryProps) {
  const t = useTranslations('auto')
  return (
    <ErrorState
      error={error}
      reset={reset}
      title={t('failed_to_load_scheduled_tasks')}
      description={t('something_went_wrong_while_loading_your')}
      loggerName='ScheduledTasksError'
    />
  )
}
