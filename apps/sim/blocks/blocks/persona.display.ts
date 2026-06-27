import { PersonaIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const PersonaBlockDisplay = {
  type: 'persona',
  name: 'Persona',
  description: 'Verify identities with Persona',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: PersonaIcon,
  longDescription:
    'Integrate Persona identity verification into the workflow. Manage the full inquiry lifecycle (create, update, approve, decline, review, resume, expire, redact), generate one-time verification links and PDF summaries, manage accounts including CSV bulk import, run watchlist and adverse media reports, review cases, retrieve verifications and documents, and discover inquiry templates.',
  docsLink: 'https://docs.sim.ai/integrations/persona',
  integrationType: IntegrationType.Security,
} satisfies BlockDisplay
