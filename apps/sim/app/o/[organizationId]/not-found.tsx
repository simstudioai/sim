'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { organizationRoutes } from '@/lib/navigation/paths'
import { Button } from '@/platform/design-system/components/button/button'
import { RouteStatus } from '@/platform/embedded/app/(shell)/_components/route-status/route-status'

export default function OrganizationNotFound() {
  const router = useRouter()
  const { organizationId } = useParams<{ organizationId?: string }>()
  const homeHref = organizationId ? organizationRoutes(organizationId).home : '/o'

  return (
    <RouteStatus
      title='Page not found'
      description="The page you're looking for doesn't exist or has been moved."
      actions={
        <>
          <Button icon='I093' onClick={() => router.back()}>
            Go back
          </Button>
          <Button variant='primary' icon='I104' render={<Link href={homeHref} />}>
            Return home
          </Button>
        </>
      }
    />
  )
}
