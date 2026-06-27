import { TableIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'

export const TableBlockDisplay = {
  type: 'table',
  name: 'Table',
  description: 'User-defined data tables',
  category: 'blocks',
  bgColor: '#10B981',
  icon: TableIcon,
  longDescription:
    'Create and manage custom data tables. Store, query, and manipulate structured data within workflows.',
  docsLink: 'https://docs.simstudio.ai/tools/table',
} satisfies BlockDisplay
