import type { ComboboxOption } from '@/components/emcn'
import { AuditResourceType } from '@/lib/audit/log'

const ACRONYMS = new Set(['API', 'BYOK', 'MCP', 'OAuth'])

function formatResourceLabel(key: string): string {
  const words = key.split('_')
  return words
    .map((w) => {
      const upper = w.toUpperCase()
      if (ACRONYMS.has(upper)) return upper
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    })
    .join(' ')
    .replace('OAUTH', 'OAuth')
}

export const RESOURCE_TYPE_OPTIONS: ComboboxOption[] = [
  { label: 'All Types', value: '' },
  ...(Object.entries(AuditResourceType) as [string, string][])
    .map(([key, value]) => ({ label: formatResourceLabel(key), value }))
    .sort((a, b) => a.label.localeCompare(b.label)),
]
