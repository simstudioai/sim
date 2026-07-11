'use client'

import { ArrowLeft } from '@sim/emcn/icons'
import { useParams, useRouter } from 'next/navigation'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'

/**
 * Route-level loading fallback (Next.js convention) and the `Suspense`
 * fallback in `page.tsx` — `CreditUsageView` reads `useSearchParams` via
 * nuqs, so it must suspend behind a boundary. Rendering the real chrome
 * here means a suspend never flashes a blank frame.
 */
export default function CreditUsageLoading() {
  const router = useRouter()
  const { workspaceId } = useParams<{ workspaceId: string }>()

  return (
    <SettingsPanel
      back={{
        text: 'Billing',
        icon: ArrowLeft,
        onSelect: () => router.push(`/workspace/${workspaceId}/settings/billing`),
      }}
      title='Credit usage'
      description='Every credit-consuming event behind your usage.'
    />
  )
}
