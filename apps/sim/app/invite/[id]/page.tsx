import { Suspense } from 'react'
import type { Metadata } from 'next'
import { isRegistrationDisabled } from '@/lib/core/config/env-flags'
import Invite from '@/app/invite/[id]/invite'
import InviteLoading from '@/app/invite/[id]/loading'

export const metadata: Metadata = {
  title: 'Invite',
  robots: { index: false },
}

export const dynamic = 'force-dynamic'

export default function InvitePage() {
  return (
    <Suspense fallback={<InviteLoading />}>
      <Invite registrationDisabled={isRegistrationDisabled} />
    </Suspense>
  )
}
