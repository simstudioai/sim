'use client'

import { ChipLink } from '@sim/emcn'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { buildUpgradeHref } from '@/lib/billing/upgrade-reasons'
import { prefetchUpgradeBillingData } from '@/hooks/queries/subscription'
import { prefetchWorkspaceSettings } from '@/hooks/queries/workspace'

interface DeployUpgradeGateProps {
  feature: 'API' | 'MCP'
}

export function DeployUpgradeGate({ feature }: DeployUpgradeGateProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const upgradeHref = buildUpgradeHref(workspaceId)

  // Warm the upgrade route + the queries it gates on so the click lands on
  // cached data. ChipLink isn't memoized, so no useCallback is needed.
  const prefetchUpgrade = () => {
    router.prefetch(upgradeHref)
    prefetchUpgradeBillingData(queryClient)
    prefetchWorkspaceSettings(queryClient, workspaceId)
  }

  return (
    <div className='flex h-full flex-col items-center justify-center gap-4 py-20'>
      <div className='max-w-[28rem] text-center'>
        <h3 className='font-medium text-[16px] text-[var(--text-primary)]'>
          {feature} deployment requires a paid plan
        </h3>
        <p className='mt-1.5 text-[14px] text-[var(--text-muted)]'>
          {feature} deployment lets external apps run this workflow programmatically. Upgrade to Pro
          or higher to enable it.
        </p>
      </div>
      <ChipLink
        href={upgradeHref}
        variant='primary'
        rightIcon={ArrowRight}
        onMouseEnter={prefetchUpgrade}
        onFocus={prefetchUpgrade}
      >
        Explore plans
      </ChipLink>
    </div>
  )
}
