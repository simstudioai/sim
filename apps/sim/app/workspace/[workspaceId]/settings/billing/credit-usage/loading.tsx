'use client'

import { ArrowLeft } from '@sim/emcn/icons'
import { useParams, useRouter } from 'next/navigation'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'

interface CreditUsageLoadingProps {
  backHref: string
}

/**
 * Shared credit-usage loading chrome with an explicit navigation destination.
 */
export function CreditUsageLoading({ backHref }: CreditUsageLoadingProps) {
  const router = useRouter()

  return (
    <SettingsPanel
      back={{
        text: 'Billing',
        icon: ArrowLeft,
        onSelect: () => router.push(backHref),
      }}
      title='Credit usage'
      description='Every credit-consuming event behind your usage.'
    />
  )
}

/**
 * Workspace route-level loading fallback used by Next.js and `page.tsx`.
 */
export default function WorkspaceCreditUsageLoading() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  return <CreditUsageLoading backHref={`/workspace/${workspaceId}/settings/billing`} />
}
