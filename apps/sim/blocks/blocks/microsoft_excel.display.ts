import { MicrosoftExcelIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const MicrosoftExcelBlockDisplay = {
  type: 'microsoft_excel',
  name: 'Microsoft Excel (Legacy)',
  description: 'Read, write, and update data',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: MicrosoftExcelIcon,
  longDescription:
    'Integrate Microsoft Excel into the workflow. Can read, write, update, add to table, and create new worksheets.',
  docsLink: 'https://docs.sim.ai/integrations/microsoft_excel',
  integrationType: IntegrationType.Documents,
  hideFromToolbar: true,
} satisfies BlockDisplay

export const MicrosoftExcelV2BlockDisplay = {
  type: 'microsoft_excel_v2',
  name: 'Microsoft Excel',
  description: 'Read and write data with sheet selection',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: MicrosoftExcelIcon,
  longDescription:
    'Integrate Microsoft Excel into the workflow with explicit sheet selection. Can read and write data in specific sheets.',
  docsLink: 'https://docs.sim.ai/integrations/microsoft_excel',
  integrationType: IntegrationType.Documents,
  hideFromToolbar: false,
} satisfies BlockDisplay
