'use client'

import { Button, buttonVariants } from '@sim/emcn'
import { ArrowLeft, Compass, Home } from '@sim/emcn/icons'
import Link from 'next/link'
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
