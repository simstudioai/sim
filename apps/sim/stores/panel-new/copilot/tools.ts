// Copilot tool definitions with schemas for LLM consumption
export const COPILOT_TOOLS = [
  {
    id: 'run_workflow',
    description:
      'Execute the current workflow. Use this to run workflows that require manual execution or input fields.',
    parameters: {
      type: 'object',
      properties: {
        workflow_input: {
          type: 'object',
          description:
            'JSON object with key-value mappings where each key is an input field name required by the workflow. For example: {"message": "Hello", "temperature": 0.7}',
        },
      },
      required: [],
    },
  },
] as const
