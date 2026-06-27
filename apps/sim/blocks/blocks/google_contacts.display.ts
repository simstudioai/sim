import { GoogleContactsIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const GoogleContactsBlockDisplay = {
  type: 'google_contacts',
  name: 'Google Contacts',
  description: 'Manage Google Contacts',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: GoogleContactsIcon,
  longDescription:
    'Integrate Google Contacts into the workflow. Can create, read, update, delete, list, and search contacts.',
  docsLink: 'https://docs.sim.ai/integrations/google_contacts',
  integrationType: IntegrationType.Productivity,
} satisfies BlockDisplay
