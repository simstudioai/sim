import { GmailIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const GmailBlockDisplay = {
  type: 'gmail',
  name: 'Gmail (Legacy)',
  description: 'Send, read, search, and move Gmail messages or trigger workflows from Gmail events',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: GmailIcon,
  longDescription:
    'Integrate Gmail into the workflow. Can send, read, search, and move emails. Can be used in trigger mode to trigger a workflow when a new email is received.',
  docsLink: 'https://docs.sim.ai/integrations/gmail',
  integrationType: IntegrationType.Email,
  hideFromToolbar: true,
  triggerAllowed: true,
} satisfies BlockDisplay

export const GmailV2BlockDisplay = {
  ...GmailBlockDisplay,
  type: 'gmail_v2',
  name: 'Gmail',
  integrationType: IntegrationType.Email,
  hideFromToolbar: false,
} satisfies BlockDisplay
