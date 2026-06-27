import { AirtableIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const AirtableBlockDisplay = {
  type: 'airtable',
  name: 'Airtable',
  description: 'Read, create, and update Airtable',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: AirtableIcon,
  longDescription:
    'Integrates Airtable into the workflow. Can list bases, list tables (with schema), and create, get, list, or update records. Can also be used in trigger mode to trigger a workflow when an update is made to an Airtable table.',
  docsLink: 'https://docs.sim.ai/integrations/airtable',
  integrationType: IntegrationType.Databases,
} satisfies BlockDisplay
