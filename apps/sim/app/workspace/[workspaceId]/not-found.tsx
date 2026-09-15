'use client'

import { Chip, ChipLink } from '@sim/emcn'
import { ArrowLeft, Compass, Home } from '@sim/emcn/icons'
import { useParams, useRouter } from 'next/navigation'
import { ErrorShell } from '@/app/workspace/[workspaceId]/components'

export default function WorkspaceNotFound() {
  const router = useRouter()
  const { workspaceId } = useParams<{ workspaceId?: string }>()
  const homeHref = workspaceId ? `/workspace/${workspaceId}` : '/'

  return (
    <ErrorShell
      title='Page not found'
      description="The page you're looking for doesn't exist or has been moved. Head back to your workspace to keep building."
      icon={<Compass className='size-[22px]' />}
    >
      <Chip leftIcon={ArrowLeft} onClick={() => router.back()}>
        Go back
      </Chip>
      <ChipLink href={homeHref} variant='primary' leftIcon={Home}>
        Return home
      </ChipLink>
    </ErrorShell>
  )
}
