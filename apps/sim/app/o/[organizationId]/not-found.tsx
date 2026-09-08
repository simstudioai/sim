'use client'

import { Chip, ChipLink } from '@sim/emcn'
import { ArrowLeft, Compass, Home } from '@sim/emcn/icons'
import { useParams, useRouter } from 'next/navigation'
import { organizationRoutes } from '@/lib/navigation/paths'
import { ErrorShell } from '@/app/workspace/[workspaceId]/components/error/error'

export default function OrganizationNotFound() {
  const router = useRouter()
  const { organizationId } = useParams<{ organizationId?: string }>()
  const homeHref = organizationId ? organizationRoutes(organizationId).home : '/o'

  return (
    <ErrorShell
      title='Page not found'
      description="The page you're looking for doesn't exist or has been moved."
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
