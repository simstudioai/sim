'use client'

import { Chip } from '@sim/emcn'
import { ArrowLeft } from '@sim/emcn/icons'
import { CredentialDetailLayout } from '@/app/workspace/[workspaceId]/components/credential-detail'

/**
 * Route-level loading fallback (Next.js convention) and the `Suspense`
 * fallback in `page.tsx` — `CreditUsageView` reads `useSearchParams` via
 * nuqs, so it must suspend behind a boundary. Rendering the real chrome
 * here means a suspend never flashes a blank frame.
 */
export default function CreditUsageLoading() {
  return (
    <CredentialDetailLayout
      back={
        <Chip leftIcon={ArrowLeft} disabled>
          Billing
        </Chip>
      }
    >
      <div className='flex flex-col gap-1'>
        <h1 className='font-medium text-[var(--text-body)] text-lg'>Credit usage</h1>
        <p className='text-[var(--text-muted)] text-md'>
          Every credit-consuming event behind your usage.
        </p>
      </div>
    </CredentialDetailLayout>
  )
}
