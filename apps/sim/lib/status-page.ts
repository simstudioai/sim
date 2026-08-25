import { z } from 'zod'

export const STATUS_PAGE_URL = 'https://status.sim.ai' as const
const STATUS_PAGE_API_URL = `${STATUS_PAGE_URL}/api/v2/status.json` as const

const statusPageIndicatorSchema = z.enum(['none', 'minor', 'major', 'critical'])

const statusPageSummarySchema = z.object({
  status: z.object({
    description: z
      .string()
      .min(1, 'Status description cannot be empty')
      .max(200, 'Status description cannot exceed 200 characters'),
    indicator: statusPageIndicatorSchema,
  }),
})

export type StatusPageIndicator = z.output<typeof statusPageIndicatorSchema>
export type StatusPageSummary = z.output<typeof statusPageSummarySchema>

/** Loads and validates Sim's public service status. */
export async function fetchStatusPageSummary(signal?: AbortSignal): Promise<StatusPageSummary> {
  // boundary-raw-fetch: external Incident.io status API, not a same-origin Sim API
  const response = await fetch(STATUS_PAGE_API_URL, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal,
  })

  if (!response.ok) {
    throw new Error(`Status page request failed with ${response.status}`)
  }

  return statusPageSummarySchema.parse(await response.json())
}
