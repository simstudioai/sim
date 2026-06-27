'use client'

import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/emcn'
import { ArrowLeft } from '@/components/emcn/icons'
import { type ErrorBoundaryProps, ErrorState } from '@/app/workspace/[workspaceId]/components'
import { useTranslations } from 'next-intl'

export default function TableError({ error, reset }: ErrorBoundaryProps) {
  const t = useTranslations('auto')
  const router = useRouter()
  const { workspaceId } = useParams<{ workspaceId: string }>()

  return (
    <ErrorState
      error={error}
      reset={reset}
      title={t('failed_to_load_table')}
      description={t('something_went_wrong_while_loading_this')}
      loggerName='TableError'
    >
      <Button
        variant='default'
        size='md'
        onClick={() => router.push(`/workspace/${workspaceId}/tables`)}
      >
        <ArrowLeft className='mr-1.5 size-[14px]' />
        {t('go_back')}
      </Button>
    </ErrorState>
  )
}
