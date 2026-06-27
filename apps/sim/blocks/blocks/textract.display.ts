import { TextractIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const TextractBlockDisplay = {
  type: 'textract',
  name: 'AWS Textract',
  description: 'Extract text, tables, and forms from documents',
  category: 'tools',
  bgColor: 'linear-gradient(135deg, #055F4E 0%, #56C0A7 100%)',
  icon: TextractIcon,
  iconColor: '#56C0A7',
  longDescription: `Integrate AWS Textract into your workflow to extract text, tables, forms, and key-value pairs from documents. Single-page mode supports JPEG, PNG, and single-page PDF. Multi-page mode supports multi-page PDF and TIFF.`,
  docsLink: 'https://docs.sim.ai/integrations/textract',
  integrationType: IntegrationType.AI,
  hideFromToolbar: true,
} satisfies BlockDisplay

export const TextractV2BlockDisplay = {
  ...TextractBlockDisplay,
  type: 'textract_v2',
  name: 'AWS Textract',
  hideFromToolbar: false,
} satisfies BlockDisplay
