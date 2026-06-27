import { CursorIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const CursorBlockDisplay = {
  type: 'cursor',
  name: 'Cursor (Legacy)',
  description: 'Launch and manage Cursor cloud agents to work on GitHub repositories',
  category: 'tools',
  bgColor: '#1E1E1E',
  icon: CursorIcon,
  longDescription:
    'Interact with Cursor Cloud Agents API to launch AI agents that can work on your GitHub repositories. Supports launching agents, adding follow-up instructions, checking status, viewing conversations, and managing agent lifecycle.',
  docsLink: 'https://cursor.com/docs/cloud-agent/api/endpoints',
  integrationType: IntegrationType.DevOps,
  hideFromToolbar: true,
} satisfies BlockDisplay

export const CursorV2BlockDisplay = {
  ...CursorBlockDisplay,
  type: 'cursor_v2',
  name: 'Cursor',
  description: 'Launch and manage Cursor cloud agents to work on GitHub repositories',
  longDescription:
    'Interact with Cursor Cloud Agents API to launch AI agents that can work on your GitHub repositories. Supports launching agents, adding follow-up instructions, checking status, viewing conversations, and managing agent lifecycle.',
  hideFromToolbar: false,
} satisfies BlockDisplay
