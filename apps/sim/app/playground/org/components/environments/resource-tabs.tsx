import { Chip } from '@sim/emcn'
import {
  RESOURCE_TABS,
  type ResourceTabId,
} from '@/app/playground/org/components/environments/mapping-model'

interface ResourceTabsProps {
  value: ResourceTabId
  /** Rows per sub-tab, shown beside the label when there are any. */
  counts: ReadonlyMap<ResourceTabId, number>
  onChange: (id: ResourceTabId) => void
}

/** The resource types of the mapping grid, in the sync view's order. */
export function ResourceTabs({ value, counts, onChange }: ResourceTabsProps) {
  return (
    <nav aria-label='Resource types' className='flex flex-wrap items-center gap-1'>
      {RESOURCE_TABS.map((tab) => {
        const count = counts.get(tab.id) ?? 0
        return (
          <Chip
            key={tab.id}
            active={value === tab.id}
            onClick={() => onChange(tab.id)}
            rightAdornment={
              count > 0 ? (
                <span className='text-[var(--text-muted)] text-caption tabular-nums'>{count}</span>
              ) : undefined
            }
          >
            {tab.label}
          </Chip>
        )
      })}
    </nav>
  )
}
