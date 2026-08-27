import { Suspense } from 'react'
import type { Metadata } from 'next'
import { isRegistrationDisabled } from '@/lib/core/config/env-flags'
import EnterpriseOwnerClaim from '@/app/enterprise/claim/[id]/enterprise-owner-claim'
import InviteLoading from '@/app/invite/[id]/loading'

export const metadata: Metadata = {
  title: 'Enterprise invitation',
  robots: { index: false },
}

export const dynamic = 'force-dynamic'

export default function EnterpriseOwnerClaimPage() {
  return (
    <Suspense fallback={<InviteLoading />}>
      <EnterpriseOwnerClaim registrationDisabled={isRegistrationDisabled} />
    </Suspense>
  )
}
