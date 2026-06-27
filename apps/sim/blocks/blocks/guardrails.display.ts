import { ShieldCheckIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'

export const GuardrailsBlockDisplay = {
  type: 'guardrails',
  name: 'Guardrails',
  description: 'Validate content with guardrails',
  category: 'blocks',
  bgColor: '#3D642D',
  icon: ShieldCheckIcon,
  longDescription:
    'Validate content using guardrails. Check if content is valid JSON, matches a regex pattern, detect hallucinations using RAG + LLM scoring, or detect PII.',
  docsLink: 'https://docs.sim.ai/workflows/blocks/guardrails',
} satisfies BlockDisplay
