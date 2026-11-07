import { formatDateTime } from '@sim/utils/formatting'
import type { MothershipTab } from '@/app/workspace/[workspaceId]/settings/components/mothership/search-params'
import type { MothershipEnv } from '@/hooks/queries/mothership-admin'

export const TABS: { id: MothershipTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'licenses', label: 'Licenses' },
  { id: 'byok', label: 'BYOK' },
]

export const ENV_OPTIONS: { value: MothershipEnv; label: string }[] = [
  { value: 'dev', label: 'Dev' },
  { value: 'staging', label: 'Staging' },
  { value: 'prod', label: 'Prod' },
]

export function defaultTimeRange() {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - 7)
  return {
    start: start.toISOString().slice(0, 16),
    end: end.toISOString().slice(0, 16),
  }
}

export function toRFC3339(local: string) {
  if (!local) return ''
  return new Date(local).toISOString()
}

export function formatCost(cost: number) {
  return `$${cost.toFixed(4)}`
}

export function formatDate(d: string | null | undefined) {
  if (!d) return '—'
  const date = new Date(d)
  if (Number.isNaN(date.getTime())) return '—'
  return formatDateTime(date)
}
