'use client'

import {
  type MothershipEnv,
  useMothershipLicenses,
  useMothershipRequests,
  useMothershipUserBreakdown,
} from '@/hooks/queries/mothership-admin'

const REQUEST_LIMIT = 100

interface MothershipUserUsage {
  user_id: string
  request_count: number
  total_cost: number
  last_request: string
}

interface MothershipUsageSummary {
  total_requests?: number
  total_users?: number
  users?: MothershipUserUsage[]
}

interface MothershipRequest {
  request_id: string
  model: string
  duration_ms: number
  billed_total_cost: number
  tool_call_count: number
  error: boolean
  aborted: boolean
  created_at: string
}

interface MothershipRequestPage {
  count?: number
  requests?: MothershipRequest[]
}

interface MothershipLicense {
  id: string
  name: string
  count: number
  expiration_date?: string
  created_at: string
}

interface MothershipLicenseList {
  licenses?: MothershipLicense[]
}

/**
 * Usage in one environment over a time range: the per-user breakdown with its total cost, and the
 * most recent requests. The admin proxy returns upstream JSON verbatim, so the shapes are named here.
 */
export function useMothershipOverview(environment: MothershipEnv, start: string, end: string) {
  const breakdown = useMothershipUserBreakdown(environment, start, end)
  const requests = useMothershipRequests(environment, start, end)
  const summary: MothershipUsageSummary | undefined = breakdown.data
  const page: MothershipRequestPage | undefined = requests.data
  return {
    breakdown: summary,
    breakdownLoading: breakdown.isLoading,
    totalCost: summary?.users?.reduce((sum, user) => sum + user.total_cost, 0),
    recentRequests: page?.requests?.slice(0, REQUEST_LIMIT),
    requestCount: page?.count,
    requestsLoading: requests.isLoading,
  }
}

/** Every license issued in one environment. */
export function useMothershipLicenseList(environment: MothershipEnv) {
  const { data, isLoading } = useMothershipLicenses(environment)
  const list: MothershipLicenseList | undefined = data
  return { licenses: list?.licenses, isLoading }
}
