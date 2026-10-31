import { Upload } from '@sim/emcn/icons'
import type { ResourceColumn } from '@/app/workspace/[workspaceId]/components/resource/resource'

/** Shared by the page and its loading chrome so the skeleton matches the table. */
export const PEOPLE_COLUMNS = [
  { id: 'name', header: 'Name', widthMultiplier: 1.4 },
  { id: 'title', header: 'Title', widthMultiplier: 1.4 },
  { id: 'department', header: 'Department' },
  { id: 'location', header: 'Location' },
  { id: 'manager', header: 'Manager', widthMultiplier: 1.2 },
] as const satisfies readonly ResourceColumn[]

export const PEOPLE_SEARCH_PLACEHOLDER = 'Search people...'

export const IMPORT_PEOPLE_ACTION = { text: 'Import', icon: Upload } as const
