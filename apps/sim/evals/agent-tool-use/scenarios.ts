import type { AgentToolUseScenario, EvalToolDefinition } from '@/evals/agent-tool-use/types'

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

const getCurrentWeather: EvalToolDefinition = {
  name: 'get_current_weather',
  description: 'Get the current weather for a city right now.',
  parameters: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
  },
}

const getWeatherForecast: EvalToolDefinition = {
  name: 'get_weather_forecast',
  description: 'Get the weather forecast for a city on a future date.',
  parameters: {
    type: 'object',
    properties: { city: { type: 'string' }, date: { type: 'string' } },
    required: ['city', 'date'],
  },
}

const getUser: EvalToolDefinition = {
  name: 'get_user',
  description: 'Get a user profile by id.',
  parameters: {
    type: 'object',
    properties: { userId: { type: 'string' } },
    required: ['userId'],
  },
}

const getUserSettings: EvalToolDefinition = {
  name: 'get_user_settings',
  description: "Get a user's account settings, including timezone and locale.",
  parameters: {
    type: 'object',
    properties: { userId: { type: 'string' } },
    required: ['userId'],
  },
}

const listOrders: EvalToolDefinition = {
  name: 'list_orders',
  description: 'List order ids for a user.',
  parameters: {
    type: 'object',
    properties: { userId: { type: 'string' } },
    required: ['userId'],
  },
}

const getOrder: EvalToolDefinition = {
  name: 'get_order',
  description: 'Get an order by id.',
  parameters: {
    type: 'object',
    properties: { orderId: { type: 'string' } },
    required: ['orderId'],
  },
}

const getShipping: EvalToolDefinition = {
  name: 'get_shipping',
  description: 'Get the shipping status for an order.',
  parameters: {
    type: 'object',
    properties: { orderId: { type: 'string' } },
    required: ['orderId'],
  },
}

/**
 * The tool-use suite: reliability plus adversarial cases (no-tool-needed,
 * near-duplicate tools, empty results, long chains). Each script is the model
 * transcript; the loop, not the model, is what the assertions score.
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
    judge: {
      criteria: [
        { id: 'grounding', description: 'the rate limit it states matches the retrieved snippet' },
        { id: 'completeness', description: 'answers the user request' },
      ],
      minScore: 0.7,
    },
    liveExpect: { finalContent: undefined },
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
    judge: {
      criteria: [
        { id: 'grounding', description: 'the conditions it states match the weather tool result' },
        { id: 'completeness', description: 'answers the user request' },
      ],
      minScore: 0.7,
    },
    liveExpect: { finalContent: undefined },
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
      finalContent: /ship the eval harness/i,
      maxIterations: 4,
      successfulToolCalls: 2,
    },
    judge: {
      criteria: [
        { id: 'grounding', description: "summarizes the file's actual contents" },
        { id: 'completeness', description: 'answers the user request' },
      ],
      minScore: 0.7,
    },
    liveExpect: { finalContent: undefined },
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
    /** A live model may answer with the user-facing order number and the grounded status. */
    liveExpect: { finalContent: /shipped/i },
    judge: {
      criteria: [
        {
          id: 'grounding',
          description: 'every claim about the order matches the retrieved fields',
        },
        { id: 'completeness', description: 'tells the user the order status' },
      ],
      minScore: 0.7,
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
      finalContent: /12°C[\s\S]*transit strike ends/i,
      maxIterations: 3,
      successfulToolCalls: 2,
    },
    judge: {
      criteria: [
        { id: 'completeness', description: 'reports both the weather and the news' },
        { id: 'grounding', description: 'the values it states match the tool results' },
      ],
      minScore: 0.7,
    },
    /** The two tools are independent; a real model may emit them in either order. */
    liveExpect: {
      toolCallSequence: undefined,
      requiredTools: ['get_weather', 'get_news'],
      finalContent: undefined,
    },
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
    judge: {
      criteria: [
        { id: 'grounding', description: 'states the exchange rate returned by the tool' },
        {
          id: 'recovery',
          description: 'makes clear the first attempt failed and the retry succeeded',
        },
      ],
      minScore: 0.7,
    },
    /** A live model decides its own retry count; only the grounded answer is asserted. */
    liveExpect: {
      toolCallSequence: undefined,
      requiredTools: ['flaky_api'],
      finalContent: undefined,
    },
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
  {
    id: 'no-tool-needed',
    name: 'answers directly without calling a tool',
    category: 'tool-selection',
    description:
      'The answer needs no tool. The loop must not invoke one even though tools are available.',
    userMessage: 'What is 2 + 2? Answer directly, no tools.',
    tools: [searchDocs, getWeather],
    script: [{ kind: 'answer', content: '4' }],
    expect: {
      finalContent: '4',
      forbiddenTools: ['search_docs', 'get_weather'],
      successfulToolCalls: 0,
      maxIterations: 2,
    },
  },
  {
    id: 'disambiguate-similar-tools',
    name: 'picks the forecast tool over the current-weather tool',
    category: 'tool-selection',
    description:
      'Two near-identical weather tools; only the forecast tool answers a future-date question.',
    userMessage: 'Will it rain tomorrow in Berlin?',
    tools: [getCurrentWeather, getWeatherForecast],
    script: [
      {
        kind: 'tools',
        calls: [
          {
            name: 'get_weather_forecast',
            args: { city: 'Berlin', date: 'tomorrow' },
            result: { success: true, output: { rain: true } },
          },
        ],
      },
      { kind: 'answer', content: 'Yes, it will rain in Berlin tomorrow.' },
    ],
    expect: {
      requiredTools: ['get_weather_forecast'],
      forbiddenTools: ['get_current_weather'],
      finalContent: /rain/i,
      maxIterations: 3,
    },
  },
  {
    id: 'empty-result-no-hallucination',
    name: 'does not invent an answer when the tool returns nothing',
    category: 'retrieval',
    description:
      'The search returns no results. The model must say it could not find the policy, not fabricate one.',
    userMessage: 'What is the refund policy?',
    tools: [searchDocs],
    script: [
      {
        kind: 'tools',
        calls: [
          {
            name: 'search_docs',
            args: { query: 'refund policy' },
            result: { success: true, output: { results: [] } },
          },
        ],
      },
      {
        kind: 'answer',
        content: 'I could not find the refund policy in the documentation.',
      },
    ],
    expect: {
      requiredTools: ['search_docs'],
      finalContent:
        /could ?n'?o?t find|cannot find|can'?t find|didn'?t find|wasn'?t able|not able to find|unable to find|no results|no matching|no documentation|no information|not covered|returned empty|came back empty|found nothing|no .*policy/i,
      maxIterations: 3,
    },
    judge: {
      criteria: [
        {
          id: 'grounding',
          description: 'does not assert a refund policy the evidence does not contain',
        },
        { id: 'honesty', description: 'makes clear it could not find the policy' },
      ],
      minScore: 0.7,
    },
  },
  {
    id: 'long-chain-dependency',
    name: 'runs a four-tool dependency chain in order',
    category: 'planning',
    description:
      'Each call depends on the previous result; the loop must preserve order across four turns.',
    userMessage: 'Where is my latest order? My user id is u-42.',
    tools: [getUser, listOrders, getOrder, getShipping],
    script: [
      {
        kind: 'tools',
        calls: [
          {
            name: 'get_user',
            args: { userId: 'u-42' },
            result: { success: true, output: { id: 'u1' } },
          },
        ],
      },
      {
        kind: 'tools',
        calls: [
          {
            name: 'list_orders',
            args: { userId: 'u1' },
            result: { success: true, output: { orderIds: ['o9'] } },
          },
        ],
      },
      {
        kind: 'tools',
        calls: [
          {
            name: 'get_order',
            args: { orderId: 'o9' },
            result: { success: true, output: { orderId: 'o9', status: 'shipped' } },
          },
        ],
      },
      {
        kind: 'tools',
        calls: [
          {
            name: 'get_shipping',
            args: { orderId: 'o9' },
            result: { success: true, output: { carrier: 'DHL', tracking: 'T-1' } },
          },
        ],
      },
      { kind: 'answer', content: 'Order o9 is shipped with DHL, tracking T-1.' },
    ],
    expect: {
      toolCallSequence: ['get_user', 'list_orders', 'get_order', 'get_shipping'],
      finalContent: /DHL/,
      maxIterations: 5,
      successfulToolCalls: 4,
    },
    /** With the id already known, a live model may skip the profile lookup. */
    liveExpect: {
      toolCallSequence: undefined,
      requiredTools: ['list_orders', 'get_order', 'get_shipping'],
      successfulToolCalls: 3,
    },
    judge: {
      criteria: [
        { id: 'grounding', description: 'uses the shipping data returned by the tools' },
        { id: 'completeness', description: 'answers where the order is' },
      ],
      minScore: 0.7,
    },
  },
  {
    id: 'near-duplicate-names',
    name: 'picks settings over the profile for a settings question',
    category: 'tool-selection',
    description:
      'get_user and get_user_settings differ by suffix; only the settings tool has the timezone.',
    userMessage: 'What timezone is set in my account settings? My user id is u-42.',
    tools: [getUser, getUserSettings],
    script: [
      {
        kind: 'tools',
        calls: [
          {
            name: 'get_user_settings',
            args: { userId: 'u-42' },
            result: { success: true, output: { timezone: 'Europe/Berlin' } },
          },
        ],
      },
      { kind: 'answer', content: 'Your account timezone is Europe/Berlin.' },
    ],
    expect: {
      requiredTools: ['get_user_settings'],
      forbiddenTools: ['get_user'],
      finalContent: /Europe\/Berlin/,
      maxIterations: 3,
    },
    judge: {
      criteria: [
        { id: 'grounding', description: 'states the timezone returned by the settings tool' },
        { id: 'completeness', description: 'answers the user request' },
      ],
      minScore: 0.7,
    },
    /** Over-calling the profile tool is inefficiency, not wrong-tool selection. */
    liveExpect: { forbiddenTools: undefined, finalContent: undefined },
  },
]
