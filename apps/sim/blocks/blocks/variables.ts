import { VariableIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const VariablesBlock: BlockConfig = {
  type: 'variables',
  name: 'Variables',
  description: 'Set workflow-scoped variables',
  longDescription:
    'Set workflow-scoped variables that can be accessed throughout the workflow using <variable.variableName> syntax. All Variables blocks share the same namespace, so later blocks can update previously set variables.',
  bgColor: '#8B5CF6',
  bestPractices: `
  - Variables are workflow-scoped and persist throughout execution (but not between executions)
  - Reference variables using <variable.variableName> syntax in any block
  - Variable names should be descriptive and follow camelCase or snake_case convention
  - Any Variables block can update existing variables by setting the same variable name
  - Variables do not appear as block outputs - they're accessed via the <variable.> prefix
  `,
  icon: VariableIcon,
  category: 'blocks',
  docsLink: 'https://docs.sim.ai/blocks/variables',
  subBlocks: [
    {
      id: 'variables',
      title: 'Variable Assignments',
      type: 'variables-input',
      description:
        'Select workflow variables and update their values during execution. Access them anywhere using <variable.variableName> syntax.',
      required: false,
    },
  ],
  tools: {
    access: [],
  },
  inputs: {
    variables: {
      type: 'json',
      description: 'Array of variable objects with name and value properties',
    },
  },
  outputs: {
    // Dynamic outputs - each assigned variable will be available as a top-level output
    // For example, if you assign variable1=5, you can reference it as <variables_block.variable1>
  },
}
