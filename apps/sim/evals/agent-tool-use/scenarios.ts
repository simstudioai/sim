import type { AgentToolUseScenario, EvalToolDefinition } from './types'

const searchDocs: EvalToolDefinition = {
  name: 'search_docs',
  description: 'Search the product documentation for a query and return matching passages.',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Search query' } },
    required: ['query'],
  },
}

const getWeather: EvalToolDefinition = {
  name: 'get_weather',
  description: 'Get the current weather for a city.',
  parameters: {
    type: 'object',
    properties: { city: { type: 'string', description: 'City name' } },
    required: ['city'],
  },
}

const sendEmail: EvalToolDefinition = {
  name: 'send_email',
  description: 'Send an email to a recipient.',
  parameters: {
    type: 'object',
    properties: {
      to: { type: 'string' },
      subject: { type: 'string' },
      body: { type: 'string' },
    },
    required: ['to', 'subject', 'body'],
  },
}

const lookupOrder: EvalToolDefinition = {
  name: 'lookup_order',
  description: 'Look up an order by its customer-facing order number.',
  parameters: {
    type: 'object',
    properties: { orderNumber: { type: 'string' } },
    required: ['orderNumber'],
  },
}

const listFiles: EvalToolDefinition = {
  name: 'list_files',
  description: 'List files in a directory.',
  parameters: {
    type: 'object',
    properties: { directory: { type: 'string' } },
    required: ['directory'],
  },
}

const readFile: EvalToolDefinition = {
  name: 'read_file',
  description: 'Read the contents of a file.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
}

const flakyApi: EvalToolDefinition = {
  name: 'flaky_api',
  description: 'Fetch a value from an upstream API that intermittently returns 503.',
  parameters: {
    type: 'object',
    properties: { resource: { type: 'string' } },
    required: ['resource'],
  },
}

const getNews: EvalToolDefinition = {
  name: 'get_news',
  description: 'Get the top news headlines for a topic.',
  parameters: {
    type: 'object',
    properties: { topic: { type: 'string' } },
    required: ['topic'],
  },
}

/**
 * The first suite: eight agent tool-use reliability cases. Each script is the
 * model transcript; the loop, not the model, is what the assertions score.
 */
export const AGENT_TOOL_USE_SCENARIOS: AgentToolUseScenario[] = [
  {
    id: 'single-tool-lookup',
    name: 'calls the one relevant tool and answers from its result',
    category: 'tool-selection',
    description:
      'A single retrieval tool is available. The loop must dispatch it once and surface the answer built from its result.',
    userMessage: 'What is the API rate limit?',
    tools: [searchDocs],
    script: [
      {
        kind: 'tools',
        calls: [
          {
            name: 'search_docs',
            args: { query: 'api rate limit' },
            result: {
              success: true,
              output: { snippet: 'The API rate limit is 100 requests per minute.' },
            },
          },
        ],
      },
      { kind: 'answer', content: 'The API rate limit is 100 requests per minute.' },
    ],
    expect: {
      toolCallSequence: ['search_docs'],
      finalContent: '100 requests per minute',
      maxIterations: 3,
      successfulToolCalls: 1,
      erroredToolCalls: 0,
    },
  },
  {
    id: 'select-correct-tool',
    name: 'selects the relevant tool and leaves the irrelevant ones unused',
    category: 'tool-selection',
    description:
      'Four tools are exposed; only the weather tool answers the question. The loop must not invoke the distractors.',
    userMessage: 'What is the weather in Berlin right now?',
    tools: [searchDocs, getWeather, sendEmail, lookupOrder],
    script: [
      {
        kind: 'tools',
        calls: [
          {
            name: 'get_weather',
            args: { city: 'Berlin' },
            result: { success: true, output: { temperatureC: 17, conditions: 'cloudy' } },
          },
        ],
      },
      { kind: 'answer', content: 'It is 17°C and cloudy in Berlin.' },
    ],
    expect: {
      requiredTools: ['get_weather'],
      forbiddenTools: ['search_docs', 'send_email', 'lookup_order'],
      finalContent: '17°C',
      maxIterations: 3,
    },
  },
  {
    id: 'multi-step-planning',
    name: 'chains two dependent tools in order before answering',
    category: 'planning',
    description:
      'The model must list a directory, then read the file it found. The loop must preserve order and feed the first result into the second turn.',
    userMessage: 'Summarize the notes file in /docs.',
    tools: [listFiles, readFile],
    script: [
      {
        kind: 'tools',
        calls: [
          {
            name: 'list_files',
            args: { directory: '/docs' },
            result: { success: true, output: { files: ['notes.md'] } },
          },
        ],
      },
      {
        kind: 'tools',
        calls: [
          {
            name: 'read_file',
            args: { path: '/docs/notes.md' },
            result: { success: true, output: { content: 'Ship the eval harness.' } },
          },
        ],
      },
      { kind: 'answer', content: 'The notes say: ship the eval harness.' },
    ],
    expect: {
      toolCallSequence: ['list_files', 'read_file'],
      finalContent: 'ship the eval harness',
      maxIterations: 4,
      successfulToolCalls: 2,
    },
  },
  {
    id: 'uses-retrieved-value',
    name: 'answers from the retrieved value rather than inventing one',
    category: 'retrieval',
    description:
      'The order lookup returns a specific identifier. The final answer must carry that retrieved value through the loop.',
    userMessage: 'What is the status of order 4471?',
    tools: [lookupOrder],
    script: [
      {
        kind: 'tools',
        calls: [
          {
            name: 'lookup_order',
            args: { orderNumber: '4471' },
            result: {
              success: true,
              output: { id: 'A-1937', status: 'shipped', carrier: 'DHL' },
            },
          },
        ],
      },
      { kind: 'answer', content: 'Order A-1937 has shipped with DHL.' },
    ],
    expect: {
      requiredTools: ['lookup_order'],
      finalContent: /A-1937.*shipped/,
      maxIterations: 3,
    },
  },
  {
    id: 'parallel-independent-tools',
    name: 'dispatches independent tools from one turn',
    category: 'planning',
    description:
      'A single model turn requests two independent tools. The loop must execute both and fold both results back into the next turn.',
    userMessage: 'Give me the weather and the news for Berlin.',
    tools: [getWeather, getNews],
    script: [
      {
        kind: 'tools',
        calls: [
          {
            name: 'get_weather',
            args: { city: 'Berlin' },
            result: { success: true, output: { temperatureC: 12 } },
          },
          {
            name: 'get_news',
            args: { topic: 'Berlin' },
            result: { success: true, output: { headline: 'Transit strike ends' } },
          },
        ],
      },
      { kind: 'answer', content: 'It is 12°C in Berlin. Top story: transit strike ends.' },
    ],
    expect: {
      toolCallSequence: ['get_weather', 'get_news'],
      finalContent: /12°C.*transit strike ends/,
      maxIterations: 3,
      successfulToolCalls: 2,
    },
    /** The two tools are independent; a real model may emit them in either order. */
    liveExpect: { toolCallSequence: undefined, requiredTools: ['get_weather', 'get_news'] },
  },
  {
    id: 'recovers-from-tool-error',
    name: 'retries a failing tool and completes the turn',
    category: 'recovery',
    description:
      'The first call errors with a 503 and the second succeeds. The error must be fed back to the model, not thrown out of the loop.',
    userMessage: 'Fetch the current exchange rate from flaky_api.',
    tools: [flakyApi],
    script: [
      {
        kind: 'tools',
        calls: [
          {
            name: 'flaky_api',
            args: { resource: 'exchange-rate' },
            result: { success: false, error: '503 Service Unavailable' },
          },
        ],
      },
      {
        kind: 'tools',
        calls: [
          {
            name: 'flaky_api',
            args: { resource: 'exchange-rate' },
            result: { success: true, output: { usdToEur: 0.92 } },
          },
        ],
      },
      { kind: 'answer', content: 'The exchange rate is 0.92 USD to EUR after a retry.' },
    ],
    expect: {
      toolCallSequence: ['flaky_api', 'flaky_api'],
      finalContent: '0.92',
      maxIterations: 4,
      successfulToolCalls: 1,
      erroredToolCalls: 1,
    },
    /** A live model decides its own retry count; only the grounded answer is asserted. */
    liveExpect: { toolCallSequence: undefined, requiredTools: ['flaky_api'] },
  },
  {
    id: 'recovers-from-unknown-tool',
    name: 'recovers when the model asks for a tool that does not exist',
    category: 'recovery',
    description:
      'The model hallucinates a tool name first. The loop must return a tool-not-found error to the model instead of failing the run.',
    userMessage: 'Search the docs for the rate limit.',
    tools: [searchDocs],
    scriptedOnly: true,
    script: [
      { kind: 'tools', calls: [{ name: 'nonexistent_tool', args: { query: 'rate limit' } }] },
      {
        kind: 'tools',
        calls: [
          {
            name: 'search_docs',
            args: { query: 'rate limit' },
            result: { success: true, output: { snippet: '100 requests per minute.' } },
          },
        ],
      },
      { kind: 'answer', content: 'The rate limit is 100 requests per minute.' },
    ],
    expect: {
      toolCallSequence: ['nonexistent_tool', 'search_docs'],
      finalContent: '100 requests per minute',
      maxIterations: 4,
      successfulToolCalls: 1,
      erroredToolCalls: 1,
    },
  },
  {
    id: 'recovers-from-malformed-arguments',
    name: 'does not execute a tool with malformed argument JSON and recovers',
    category: 'recovery',
    description:
      'The first call emits truncated JSON. The loop must skip execution, return the parse error, and let the corrected second call succeed.',
    userMessage: 'Search the docs for the rate limit.',
    tools: [searchDocs],
    scriptedOnly: true,
    script: [
      { kind: 'tools', calls: [{ name: 'search_docs', argumentsJson: '{"query":' }] },
      {
        kind: 'tools',
        calls: [
          {
            name: 'search_docs',
            args: { query: 'rate limit' },
            result: { success: true, output: { snippet: '100 requests per minute.' } },
          },
        ],
      },
      { kind: 'answer', content: 'The rate limit is 100 requests per minute.' },
    ],
    expect: {
      toolCallSequence: ['search_docs', 'search_docs'],
      finalContent: '100 requests per minute',
      maxIterations: 4,
      successfulToolCalls: 1,
      erroredToolCalls: 1,
    },
  },
]
