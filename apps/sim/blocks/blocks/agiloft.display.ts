import { AgiloftIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const AgiloftBlockDisplay = {
  type: 'agiloft',
  name: 'Agiloft',
  description: 'Manage records in Agiloft CLM',
  category: 'tools',
  bgColor: '#001028',
  icon: AgiloftIcon,
  longDescription:
    'Integrate with Agiloft contract lifecycle management to create, read, update, delete, and search records. Supports file attachments, SQL-based selection, saved searches, and record locking across any table in your knowledge base.',
  docsLink: 'https://docs.sim.ai/integrations/agiloft',
  integrationType: IntegrationType.Productivity,
} satisfies BlockDisplay
