import { ChipLink } from '@sim/emcn-legacy'
import type { Metadata } from 'next'
import { StatusPage } from '@/components/status-page'
import { SITE_NOT_FOUND_METADATA } from '@/app/_shell/status-not-found'

export const metadata: Metadata = SITE_NOT_FOUND_METADATA

export default function LandingNotFound() {
  return (
    <StatusPage
      title='Page not found'
      description="The page you're looking for doesn't exist or has been moved."
    >
      <ChipLink variant='primary' href='/'>
        Return home
      </ChipLink>
    </StatusPage>
  )
}
