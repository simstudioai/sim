import { GoogleSlidesIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const GoogleSlidesBlockDisplay = {
  type: 'google_slides',
  name: 'Google Slides (Legacy)',
  description: 'Read, write, and create presentations',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: GoogleSlidesIcon,
  longDescription:
    'Build, edit, and export branded Google Slides presentations end-to-end. Copy a template, replace text and image tokens, embed Sheets charts, style text and shapes with brand fonts and colors, manage tables and layouts, group elements, run atomic batch updates, and export to PDF or PPTX.',
  docsLink: 'https://docs.sim.ai/integrations/google_slides',
  integrationType: IntegrationType.Documents,
  hideFromToolbar: true,
} satisfies BlockDisplay

export const GoogleSlidesV2BlockDisplay = {
  ...GoogleSlidesBlockDisplay,
  type: 'google_slides_v2',
  name: 'Google Slides',
  description: 'Read, write, and create presentations',
  integrationType: IntegrationType.Documents,
  hideFromToolbar: false,
} satisfies BlockDisplay
