import type { ExecutorScenario } from '@/evals/agent-tool-use/executor-harness'

/**
 * Agent context evals.
 *
 * These drive the real Agent block inside the `DAGExecutor` with conversation
 * memory on. The memory read is stubbed per conversation id, so the provider
 * request shows exactly what the handler assembled: prior history, then the new
 * user prompt, with the system prompt preserved. A handler that passed the
 * wrong conversation id, dropped history, or reordered the prompt fails.
 *
 * Windowing inside the memory service (`sliding_window`, token budgets) is
 * covered by its own unit tests; this suite covers the assembly the model sees.
 */
export const AGENT_CONTEXT_SCENARIOS: ExecutorScenario[] = [
  {
    id: 'context-remembers-prior-turns',
    name: 'includes prior conversation memory before the new user prompt',
    category: 'retrieval',
    description:
      'Memory holds two prior turns. The provider request must contain both, in order, followed by the new user prompt, with the system prompt present.',
    workflowInput: {},
    agent: {
      model: 'gpt-4o',
      systemPrompt: 'You are a helpful assistant.',
      userPrompt: 'What is my name?',
      memory: {
        conversationId: 'conv-ada',
        history: [
          { role: 'user', content: 'My name is Ada.' },
          { role: 'assistant', content: 'Nice to meet you, Ada.' },
        ],
      },
    },
    providerResponse: {
      content: 'Your name is Ada.',
      tokens: { input: 30, output: 5, total: 35 },
    },
    expect: {
      succeeds: true,
      finalContent: 'Ada',
    },
  },
  {
    id: 'context-isolates-conversations',
    name: 'reads the conversation named by the block, not another',
    category: 'retrieval',
    description:
      'The memory stub only returns history for the block conversation id; any other id yields a placeholder. A handler that passed the wrong id would surface the placeholder and fail.',
    workflowInput: {},
    agent: {
      model: 'gpt-4o',
      userPrompt: 'What did we decide?',
      memory: {
        conversationId: 'conv-b',
        history: [
          { role: 'user', content: 'We decided to ship on Friday.' },
          { role: 'assistant', content: 'Shipping Friday.' },
        ],
      },
    },
    providerResponse: {
      content: 'You decided to ship on Friday.',
      tokens: { input: 25, output: 6, total: 31 },
    },
    expect: {
      succeeds: true,
      finalContent: 'Friday',
    },
  },
]
