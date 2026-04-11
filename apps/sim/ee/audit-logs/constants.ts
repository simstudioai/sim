import type { ComboboxOption } from '@/components/emcn'
import { AuditResourceType } from '@/lib/audit/types'

const ACRONYMS = new Set(['API', 'BYOK', 'MCP', 'OAUTH'])

const DISPLAY_OVERRIDES: Record<string, string> = { OAUTH: 'OAuth' }

function formatResourceLabel(key: string): string {
  return key
    .split('_')
    .map((w) => {
      const upper = w.toUpperCase()
      if (ACRONYMS.has(upper)) return DISPLAY_OVERRIDES[upper] ?? upper
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    })
    .join(' ')
}

export const RESOURCE_TYPE_OPTIONS: ComboboxOption[] = [
  { label: 'All Types', value: '' },
  ...(Object.entries(AuditResourceType) as [string, string][])
    .map(([key, value]) => ({ label: formatResourceLabel(key), value }))
    .sort((a, b) => a.label.localeCompare(b.label)),
]
