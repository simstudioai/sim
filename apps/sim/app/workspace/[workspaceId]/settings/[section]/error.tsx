'use client'

import { type ErrorBoundaryProps, ErrorState } from '@/app/workspace/[workspaceId]/components'
import { useTranslations } from 'next-intl'

export default function SettingsSectionError({ error, reset }: ErrorBoundaryProps) {
  const t = useTranslations('auto')
  return (
    <ErrorState
      error={error}
      reset={reset}
      title={t('something_went_wrong')}
      description={t('an_unexpected_error_occurred_please_try')}
      loggerName='SettingsSectionError'
    />
  )
}
