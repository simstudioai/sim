'use client'

import { useMemo } from 'react'
import { derivePlanView, type PlanView } from '@/lib/billing/client'
import { useSubscriptionData } from '@/hooks/queries/subscription'

/**
 * Result of {@link usePlanView}. `creditBalance` and `hasData` are surfaced so
 * credit-display surfaces don't need a second `useSubscriptionData` call.
 */
export interface UsePlanViewResult {
  planView: PlanView
  creditBalance: number
  isLoading: boolean
  hasData: boolean
}

/**
 * React Query wrapper over {@link useSubscriptionData} that exposes the
 * canonical {@link PlanView}. The single hook every billing surface (upgrade
 * page, home credits chip, sidebar, settings billing page) consumes for
 * plan-derived UI decisions.
 */
export function usePlanView(options?: { includeOrg?: boolean }): UsePlanViewResult {
  const { data, isLoading } = useSubscriptionData(options)
  const plan = data?.data?.plan
  const planView = useMemo(() => derivePlanView(plan), [plan])
  return {
    planView,
    creditBalance: data?.data?.creditBalance ?? 0,
    isLoading,
    hasData: Boolean(data?.data),
  }
}
