import { Plus } from '@sim/emcn/icons'
import type { ResourceColumn } from '@/app/workspace/[workspaceId]/components/resource/resource'

/** Shared by the page and its loading chrome so the skeleton matches the table. */
export const SIM_LINK_COLUMNS = [
  { id: 'name', header: 'Name' },
  { id: 'destination', header: 'Destination', widthMultiplier: 2 },
  { id: 'description', header: 'Description', widthMultiplier: 1.4 },
  { id: 'owner', header: 'Created by' },
  { id: 'access', header: 'Access' },
  { id: 'updated', header: 'Updated' },
] as const satisfies readonly ResourceColumn[]

export const SIM_LINKS_SEARCH_PLACEHOLDER = 'Search Sim links...'

export const NEW_SIM_LINK_ACTION = { text: 'New link', icon: Plus, variant: 'primary' } as const
