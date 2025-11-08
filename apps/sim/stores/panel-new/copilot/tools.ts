// Copilot tool definitions with schemas for LLM consumption
export const COPILOT_TOOLS = [
  {
    id: 'run_workflow',
    description:
      'Execute the current workflow. Use this to run workflows that require manual execution or chat input.',
    parameters: {
      type: 'object',
      properties: {
        workflow_input: {
          type: 'string',
          description:
            'Optional chat or message to include with the workflow execution. If the workflow requires chat input, you must supply a chat message here.',
        },
      },
      required: [],
    },
  },
] as const
