'use client'

import { Panels, Plus } from '@sim/emcn/icons'
import {
  type ChromeActionSpec,
  ResourceChromeFallback,
  type ResourceColumn,
} from '@/app/workspace/[workspaceId]/components'

/** Must stay identical to `interfaces.tsx`'s COLUMNS so hydration never shifts the track widths. */
const COLUMNS: ResourceColumn[] = [
  { id: 'name', header: 'Name' },
  { id: 'modules', header: 'Modules', widthMultiplier: 0.6 },
  { id: 'created', header: 'Created' },
  { id: 'owner', header: 'Owner' },
  { id: 'updated', header: 'Last Updated' },
]

const ACTIONS: ChromeActionSpec[] = [{ text: 'New interface', icon: Plus, variant: 'primary' }]

export default function InterfacesLoading() {
  return (
    <ResourceChromeFallback
      icon={Panels}
      title='Interfaces'
      columns={COLUMNS}
      actions={ACTIONS}
      searchPlaceholder='Search interfaces...'
      hasSort
      hasFilter
    />
  )
}
