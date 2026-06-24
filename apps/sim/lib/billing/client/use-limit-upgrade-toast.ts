'use client'

import { useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { toast } from '@/components/emcn'
import { buildUpgradeHref, type UpgradeReason } from '@/lib/billing/upgrade-reasons'

/**
 * Returns a callback that surfaces a usage-limit error as an actionable toast
 * with an "Upgrade" button deep-linking to the reason-tagged upgrade page.
 *
 * The toast persists until dismissed (emcn keeps actionable toasts open), so the
 * user always has the upgrade path within reach when they hit a limit.
 */
export function useLimitUpgradeToast() {
  const router = useRouter()
  const { workspaceId } = useParams<{ workspaceId: string }>()

  return useCallback(
    (reason: UpgradeReason, message: string) => {
      toast.error(message, {
        action: {
          label: 'Upgrade',
          onClick: () => router.push(buildUpgradeHref(workspaceId, reason)),
        },
      })
    },
    [router, workspaceId]
  )
}
