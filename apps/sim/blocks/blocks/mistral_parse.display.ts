import { MistralIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const MistralParseBlockDisplay = {
  type: 'mistral_parse',
  name: 'Mistral Parser (Legacy)',
  description: 'Extract text from PDF documents',
  category: 'tools',
  bgColor: '#000000',
  icon: MistralIcon,
  longDescription: `Integrate Mistral Parse into the workflow. Can extract text from uploaded PDF documents, or from a URL.`,
  docsLink: 'https://docs.sim.ai/integrations/mistral_parse',
  integrationType: IntegrationType.AI,
  hideFromToolbar: true,
} satisfies BlockDisplay

export const MistralParseV2BlockDisplay = {
  ...MistralParseBlockDisplay,
  type: 'mistral_parse_v2',
  name: 'Mistral Parser',
  description: 'Extract text from PDF documents',
  hideFromToolbar: true,
} satisfies BlockDisplay

export const MistralParseV3BlockDisplay = {
  ...MistralParseBlockDisplay,
  type: 'mistral_parse_v3',
  name: 'Mistral Parser',
  description: 'Extract text from PDF documents',
  hideFromToolbar: false,
} satisfies BlockDisplay
