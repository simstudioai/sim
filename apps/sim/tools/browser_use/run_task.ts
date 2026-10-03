import type { BrowserUseRunTaskParams, BrowserUseRunTaskResponse } from '@/tools/browser_use/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const runTaskTool: InternalToolConfig<BrowserUseRunTaskParams, BrowserUseRunTaskResponse> = {
  id: 'browser_use_run_task',
  name: 'Browser Use',
  description: 'Runs a browser automation task using BrowserUse',
  version: '1.0.0',

  params: {
    task: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'What should the browser agent do',
    },
    startUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Initial page URL to start the agent on (reduces navigation steps)',
    },
    variables: {
      type: 'json',
      required: false,
      visibility: 'user-only',
      description: 'Optional secrets injected into the task (format: {key: value})',
    },
    allowedDomains: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated list of domains the agent is allowed to visit',
    },
    maxSteps: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of steps the agent may take (default 100, max 10000)',
    },
    flashMode: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Enable flash mode (faster, less careful navigation)',
    },
    thinking: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Enable extended reasoning mode',
    },
    vision: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Vision capability: "true", "false", or "auto"',
    },
    systemPromptExtension: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Optional text appended to the agent system prompt (max 2000 chars)',
    },
    structuredOutput: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Stringified JSON schema for the structured output',
    },
    highlightElements: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Highlight interactive elements on the page (default true)',
    },
    metadata: {
      type: 'json',
      required: false,
      visibility: 'user-only',
      description: 'Custom key-value metadata (up to 10 pairs) for tracking',
    },
    model: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'LLM model identifier (e.g. browser-use-2.0)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'API key for BrowserUse API',
    },
    profile_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Browser profile ID for persistent sessions (cookies, login state)',
    },
  },

  operation: {
    input: createInternalToolOperationInput,
    modelInput: {
      mode: 'project',
      select: (params) => ({
        task: params.task,
        systemPromptExtension: params.systemPromptExtension,
        structuredOutput: params.structuredOutput,
      }),
    },
  },

  outputs: {
    id: { type: 'string', description: 'Task execution identifier' },
    success: { type: 'boolean', description: 'Task completion status' },
    output: { type: 'json', description: 'Final task output (string or structured)' },
    steps: {
      type: 'array',
      description: 'Steps the agent executed (number, memory, nextGoal, url, actions, duration)',
      items: {
        type: 'object',
        properties: {
          number: { type: 'number', description: 'Sequential step number' },
          memory: { type: 'string', description: 'Agent memory at this step' },
          evaluationPreviousGoal: {
            type: 'string',
            description: 'Evaluation of previous goal completion',
          },
          nextGoal: { type: 'string', description: 'Goal for the next step' },
          url: { type: 'string', description: 'Current URL of the browser' },
          screenshotUrl: { type: 'string', description: 'Optional screenshot URL', optional: true },
          actions: {
            type: 'array',
            description: 'Stringified JSON actions performed',
            items: { type: 'string', description: 'Action JSON' },
          },
          duration: {
            type: 'number',
            description: 'Step duration in seconds',
            optional: true,
          },
        },
      },
    },
    liveUrl: {
      type: 'string',
      description: 'Embeddable live browser session URL (active during execution)',
    },
    shareUrl: {
      type: 'string',
      description: 'Public shareable URL for the recorded session (post-run)',
    },
    sessionId: { type: 'string', description: 'Browser Use session identifier' },
  },
}
