import type { ResourceColumn } from '@/app/workspace/[workspaceId]/components'

export const DOCUMENT_COLUMNS: ResourceColumn[] = [
  { id: 'name', header: 'Name', widthMultiplier: 0.8 },
  { id: 'size', header: 'Size', widthMultiplier: 0.75 },
  { id: 'tokens', header: 'Tokens', widthMultiplier: 0.75 },
  { id: 'chunks', header: 'Chunks', widthMultiplier: 0.75 },
  { id: 'uploaded', header: 'Uploaded' },
  { id: 'status', header: 'Status' },
  { id: 'tags', header: 'Tags' },
]
