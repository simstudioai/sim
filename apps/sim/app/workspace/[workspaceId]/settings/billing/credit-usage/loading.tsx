'use client'

import { useParams } from 'next/navigation'
import { CreditUsageLoading } from '@/components/settings/sections/credit-usage/credit-usage-loading'

/**
 * Workspace route-level loading fallback used by Next.js and `page.tsx`.
 */
export default function WorkspaceCreditUsageLoading() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  return <CreditUsageLoading backHref={`/workspace/${workspaceId}/settings/billing`} />
}
