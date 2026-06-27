import { VariableIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'

export const VariablesBlockDisplay = {
  type: 'variables',
  name: 'Variables',
  description: 'Set workflow-scoped variables',
  category: 'blocks',
  bgColor: '#8B5CF6',
  icon: VariableIcon,
  longDescription:
    'Set workflow-scoped variables that can be accessed throughout the workflow using <variable.variableName> syntax. All Variables blocks share the same namespace, so later blocks can update previously set variables.',
  docsLink: 'https://docs.sim.ai/workflows/blocks/variables',
} satisfies BlockDisplay
