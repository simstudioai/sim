'use client'

import { ArrowLeft } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { ChipLink } from '@/components/emcn'

interface IntegrationBlockFallbackProps {
  workspaceId: string
}

/**
 * Loading fallback for the integration block page. Lives in a client component
 * so the lucide icon passed to `ChipLink`'s `leftIcon` prop stays inside the
 * client boundary — a Server Component cannot pass a function/component prop to
 * a Client Component.
 */
export function IntegrationBlockFallback({ workspaceId }: IntegrationBlockFallbackProps) {
  const t = useTranslations('auto')
  return (
    <div className='flex h-full flex-col bg-[var(--bg)]'>
      <div className='flex flex-shrink-0 items-center bg-[var(--bg)] px-[16px] pt-[8.5px] pb-[8.5px]'>
        <ChipLink href={`/workspace/${workspaceId}/integrations`} leftIcon={ArrowLeft}>
          {t('integrations')}
        </ChipLink>
      </div>
    </div>
  )
}
