import { VariablesBlockDisplay } from '@/blocks/blocks/variables.display'
import type { BlockConfig } from '@/blocks/types'

export const VariablesBlock: BlockConfig = {
  ...VariablesBlockDisplay,
  bestPractices: `
  - Variables are workflow-scoped and persist throughout execution (but not between executions)
  - Reference variables using <variable.variableName> syntax in any block
  - Variable names should be descriptive and follow camelCase or snake_case convention
  - Any Variables block can update existing variables by setting the same variable name
  - Variables do not appear as block outputs - they're accessed via the <variable.> prefix
  `,
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
