'use client'

import type { QueryClient } from '@tanstack/react-query'
import { parseAsStringLiteral, useQueryStates } from 'nuqs'
import { z } from 'zod'
import {
  type MothershipEnv,
  mothershipKeys,
  useMothershipLicenses,
  useMothershipRequests,
  useMothershipUserBreakdown,
} from '@/hooks/queries/mothership-admin'
import { queryView } from '@/platform/lib/data/query-view'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

export type { MothershipEnv }

export const MOTHERSHIP_ENVIRONMENTS = [
  { value: 'dev', label: 'Dev' },
  { value: 'staging', label: 'Staging' },
  { value: 'prod', label: 'Prod' },
] as const

export const MOTHERSHIP_VIEWS = [
  { value: 'overview', label: 'Overview' },
  { value: 'licenses', label: 'Licenses' },
  { value: 'byok', label: 'BYOK' },
] as const

const parameters = {
  tab: parseAsStringLiteral(['overview', 'licenses', 'byok']).withDefault('overview'),
  env: parseAsStringLiteral(['dev', 'staging', 'prod', 'default']).withDefault('dev'),
}

export function useMothershipView() {
  const [params, setParams] = useQueryStates(parameters)
  const requestLeave = useSettingsDirtyStore((state) => state.requestLeave)
  return {
    ...params,
    change: (next: Partial<typeof params>) => requestLeave(() => void setParams(next)),
  }
}

const instant = z.string().refine((date) => Number.isFinite(Date.parse(date)))
const breakdown = z.object({
  total_requests: z.number(),
  total_users: z.number(),
  users: z.array(
    z.object({
      user_id: z.string(),
      request_count: z.number(),
      total_cost: z.number(),
      last_request: instant.nullish(),
    })
  ),
})
const requests = z.object({
  count: z.number(),
  requests: z.array(
    z.object({
      request_id: z.string(),
      model: z.string().nullish(),
      duration_ms: z.number().nullish(),
      billed_total_cost: z.number().nullish(),
      tool_call_count: z.number().nullish(),
      error: z.boolean().nullish(),
      aborted: z.boolean().nullish(),
      created_at: instant,
    })
  ),
})
const licenses = z.object({
  licenses: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      count: z.number(),
      expiration_date: instant.nullish(),
      created_at: instant,
    })
  ),
})

export interface LicenseDraft {
  name: string
  approvalReference: string
  expirationDate: string | null
}

/** The admin proxy forwards upstream JSON. Check each read before displaying it. */
function readResponse<T>(
  query: Parameters<typeof queryView>[0] & { isPlaceholderData: boolean },
  schema: z.ZodType<T>
) {
  const view = queryView(query)
  if (query.isPlaceholderData) return { ...view, data: undefined, status: 'pending' as const }
  if (view.status !== 'success') return { ...view, data: undefined }
  const parsed = schema.safeParse(query.data)
  return parsed.success
    ? { ...view, data: parsed.data }
    : { ...view, data: undefined, status: 'error' as const }
}

export function useMothershipOverview(env: MothershipEnv, start: string, end: string) {
  const summary = useMothershipUserBreakdown(env, start, end)
  const recent = useMothershipRequests(env, start, end)
  return { breakdown: readResponse(summary, breakdown), requests: readResponse(recent, requests) }
}

export function refreshMothershipLicenses(client: QueryClient, env: MothershipEnv) {
  return client.invalidateQueries({ queryKey: mothershipKeys.licenses(env) })
}

export function useLicenseList(env: MothershipEnv) {
  return readResponse(useMothershipLicenses(env), licenses)
}
