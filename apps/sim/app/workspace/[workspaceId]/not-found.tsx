'use client'

import { Button, buttonVariants } from '@sim/emcn'
import { ArrowLeft, Home } from '@sim/emcn/icons'
import { Compass } from 'lucide-react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ErrorShell } from '@/app/workspace/[workspaceId]/components'

export default function WorkspaceNotFound() {
  const router = useRouter()
  const { workspaceId } = useParams<{ workspaceId?: string }>()
  const homeHref = workspaceId ? `/workspace/${workspaceId}/home` : '/'

  return (
    <ErrorShell
      title='Page not found'
      description="The page you're looking for doesn't exist or has been moved. Head back to your workspace to keep building."
      icon={<Compass className='size-[22px]' strokeWidth={1.55} />}
    >
      <Button variant='default' size='md' onClick={() => router.back()}>
        <ArrowLeft className='mr-1.5 size-[14px]' />
        Go back
      </Button>
      <Link href={homeHref} className={buttonVariants({ variant: 'primary', size: 'md' })}>
        <Home className='mr-1.5 size-[14px]' />
        Return home
      </Link>
    </ErrorShell>
  )
}
