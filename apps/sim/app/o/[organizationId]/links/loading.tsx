'use client'

import { Link, Plus } from '@sim/emcn/icons'
import {
  type ChromeActionSpec,
  ResourceChromeFallback,
} from '@/app/workspace/[workspaceId]/components/resource/components/resource-chrome-fallback'
import type { ResourceColumn } from '@/app/workspace/[workspaceId]/components/resource/resource'

const COLUMNS = [
  { id: 'name', header: 'Name' },
  { id: 'destination', header: 'Destination', widthMultiplier: 2 },
  { id: 'description', header: 'Description', widthMultiplier: 1.4 },
  { id: 'owner', header: 'Created by' },
  { id: 'access', header: 'Access' },
  { id: 'updated', header: 'Updated' },
] as const satisfies readonly ResourceColumn[]

const ACTIONS = [
  { text: 'New link', icon: Plus, variant: 'primary' },
] as const satisfies readonly ChromeActionSpec[]

export default function SimLinksLoading() {
  return (
    <ResourceChromeFallback
      icon={Link}
      title='Sim Links'
      columns={COLUMNS}
      actions={ACTIONS}
      searchPlaceholder='Search Sim links...'
      hasSort
    />
  )
}
