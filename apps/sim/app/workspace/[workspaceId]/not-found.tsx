'use client'

import { Compass } from 'lucide-react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button, buttonVariants } from '@/components/emcn'
import { ArrowLeft, Home } from '@/components/emcn/icons'
import { ErrorShell } from '@/app/workspace/[workspaceId]/components'

export default function WorkspaceNotFound() {
  const t = useTranslations('auto')
  const router = useRouter()
  const { workspaceId } = useParams<{ workspaceId?: string }>()
  const homeHref = workspaceId ? `/workspace/${workspaceId}/home` : '/'

  return (
    <ErrorShell
      title={t('page_not_found')}
      description={t('the_page_you_re_looking_for')}
      icon={<Compass className='size-[22px]' strokeWidth={1.55} />}
    >
      <Button variant='default' size='md' onClick={() => router.back()}>
        <ArrowLeft className='mr-1.5 size-[14px]' />
        {t('go_back')}
      </Button>
      <Link href={homeHref} className={buttonVariants({ variant: 'primary', size: 'md' })}>
        <Home className='mr-1.5 size-[14px]' />
        {t('return_home')}
      </Link>
    </ErrorShell>
  )
}
