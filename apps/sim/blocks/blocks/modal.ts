import { ModalIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { MODAL_SHARED_INFERENCE_URL } from '@/tools/modal/utils'

/** Operations that talk to a Modal Endpoint's OpenAI-compatible `/v1` API. */
const ENDPOINT_OPERATIONS = ['chat_completion', 'list_models']

export const ModalBlock: BlockConfig = {
  type: 'modal',
  name: 'Modal',
  description: 'Call deployed Modal functions and endpoints',
  longDescription:
    'Integrate Modal into your workflow to reach the serverless compute you already run there. Invoke a deployed Web Function or Server over HTTPS with proxy-token auth, generate completions from a model served by a Modal Endpoint, and list the models a token can reach.',
  docsLink: 'https://docs.sim.ai/integrations/modal',
  category: 'tools',
  integrationType: IntegrationType.AI,
  bgColor: '#000000',
  icon: ModalIcon,
  authMode: AuthMode.ApiKey,
  canvasPresentation: {
    defaultTitle: 'Modal',
    sentences: {
      byOperation: {
        call_function: [
          { text: 'Call', field: 'functionUrl', core: true },
          { text: 'with a', field: 'method', after: 'request' },
        ],
        chat_completion: [
          { text: 'Generate a completion with', field: 'model', core: true },
          { text: 'on', field: 'endpointUrl' },
          { text: ', prompted with', field: 'content' },
        ],
        list_models: ['List the models this token can reach', { text: 'on', field: 'endpointUrl' }],
      },
    },
  },

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Call Function', id: 'call_function' },
        { label: 'Chat Completion', id: 'chat_completion' },
        { label: 'List Models', id: 'list_models' },
      ],
      value: () => 'call_function',
    },
    {
      id: 'tokenId',
      title: 'Token ID',
      type: 'short-input',
      placeholder: 'wk-...',
      description: 'Proxy token pair from `modal workspace proxy-tokens create`',
      password: true,
      required: { field: 'operation', value: ENDPOINT_OPERATIONS },
    },
    {
      id: 'tokenSecret',
      title: 'Token Secret',
      type: 'short-input',
      placeholder: 'ws-...',
      password: true,
      required: { field: 'operation', value: ENDPOINT_OPERATIONS },
    },

    // Call Function fields
    {
      id: 'functionUrl',
      title: 'Function URL',
      canvasNoun: 'a function',
      type: 'short-input',
      placeholder: 'https://your-workspace--your-app-your-function.modal.run',
      condition: { field: 'operation', value: 'call_function' },
      required: { field: 'operation', value: 'call_function' },
    },
    {
      id: 'method',
      title: 'Method',
      type: 'dropdown',
      options: [
        { label: 'POST', id: 'POST' },
        { label: 'GET', id: 'GET' },
        { label: 'PUT', id: 'PUT' },
        { label: 'PATCH', id: 'PATCH' },
        { label: 'DELETE', id: 'DELETE' },
        { label: 'HEAD', id: 'HEAD' },
      ],
      value: () => 'POST',
      condition: { field: 'operation', value: 'call_function' },
    },
    {
      id: 'requestBody',
      title: 'Body',
      type: 'code',
      language: 'json',
      placeholder: '{\n  "prompt": "hello"\n}',
      condition: {
        field: 'operation',
        value: 'call_function',
        and: { field: 'method', value: ['GET', 'HEAD'], not: true },
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON request body for a Modal Web Function. Return ONLY the JSON object without any markdown formatting or explanation.',
        generationType: 'json-object',
        placeholder: 'Describe the request body you want to send',
      },
    },
    {
      id: 'queryParams',
      title: 'Query Parameters',
      type: 'table',
      columns: ['Key', 'Value'],
      mode: 'advanced',
      condition: { field: 'operation', value: 'call_function' },
    },
    {
      id: 'requestHeaders',
      title: 'Headers',
      type: 'table',
      columns: ['Key', 'Value'],
      mode: 'advanced',
      condition: { field: 'operation', value: 'call_function' },
    },

    // Endpoint fields
    {
      id: 'endpointUrl',
      title: 'Endpoint URL',
      canvasNoun: 'an endpoint',
      type: 'short-input',
      placeholder: MODAL_SHARED_INFERENCE_URL,
      condition: { field: 'operation', value: ENDPOINT_OPERATIONS },
    },
    {
      id: 'model',
      title: 'Model',
      type: 'short-input',
      placeholder: 'Base model repo ID, or the endpoint hostname for a Shared Endpoint',
      condition: { field: 'operation', value: 'chat_completion' },
      required: { field: 'operation', value: 'chat_completion' },
    },
    {
      id: 'systemPrompt',
      title: 'System Prompt',
      type: 'long-input',
      rows: 3,
      placeholder: 'Instructions that guide how the model responds',
      condition: { field: 'operation', value: 'chat_completion' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a system prompt that guides an LLM to behave as described. Return ONLY the prompt text without any markdown formatting or explanation.',
        generationType: 'system-prompt',
        placeholder: 'Describe how the model should behave',
      },
    },
    {
      id: 'content',
      title: 'User Message',
      canvasNoun: 'a message',
      type: 'long-input',
      rows: 3,
      placeholder: 'Message to send to the model',
      condition: { field: 'operation', value: 'chat_completion' },
      required: { field: 'operation', value: 'chat_completion' },
    },
    {
      id: 'maxTokens',
      title: 'Max Tokens',
      type: 'short-input',
      placeholder: 'Maximum number of tokens to generate',
      mode: 'advanced',
      condition: { field: 'operation', value: 'chat_completion' },
    },
    {
      id: 'temperature',
      title: 'Temperature',
      type: 'short-input',
      placeholder: 'Sampling temperature (e.g., 0.7)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'chat_completion' },
    },
    {
      id: 'topP',
      title: 'Top P',
      type: 'short-input',
      placeholder: 'Nucleus sampling probability mass between 0 and 1',
      mode: 'advanced',
      condition: { field: 'operation', value: 'chat_completion' },
    },
  ],

  tools: {
    access: ['modal_call_function', 'modal_chat_completion', 'modal_list_models'],
    config: {
      tool: (params) => `modal_${params.operation}`,
      params: (params) => {
        const { operation, tokenId, tokenSecret, ...rest } = params

        const baseParams: Record<string, unknown> = { tokenId, tokenSecret }

        switch (operation) {
          case 'call_function':
            baseParams.url = rest.functionUrl
            if (rest.method) baseParams.method = rest.method
            if (rest.requestBody !== undefined && rest.requestBody !== '') {
              baseParams.body = rest.requestBody
            }
            if (rest.queryParams) baseParams.queryParams = rest.queryParams
            if (rest.requestHeaders) baseParams.headers = rest.requestHeaders
            break
          case 'chat_completion':
            if (rest.endpointUrl) baseParams.endpointUrl = rest.endpointUrl
            baseParams.model = rest.model
            baseParams.content = rest.content
            if (rest.systemPrompt) baseParams.systemPrompt = rest.systemPrompt
            if (rest.maxTokens !== undefined && rest.maxTokens !== '') {
              baseParams.maxTokens = Number(rest.maxTokens)
            }
            if (rest.temperature !== undefined && rest.temperature !== '') {
              baseParams.temperature = Number(rest.temperature)
            }
            if (rest.topP !== undefined && rest.topP !== '') {
              baseParams.topP = Number(rest.topP)
            }
            break
          case 'list_models':
            if (rest.endpointUrl) baseParams.endpointUrl = rest.endpointUrl
            break
        }

        return baseParams
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    tokenId: { type: 'string', description: 'Modal proxy token ID' },
    tokenSecret: { type: 'string', description: 'Modal proxy token secret' },
    functionUrl: {
      type: 'string',
      description: 'URL of the deployed Modal Web Function or Server',
    },
    method: { type: 'string', description: 'HTTP method for the function call' },
    requestBody: { type: 'json', description: 'JSON request body sent to the function' },
    queryParams: { type: 'json', description: 'Query parameters appended to the function URL' },
    requestHeaders: { type: 'json', description: 'Additional request headers' },
    endpointUrl: { type: 'string', description: 'URL of the Modal Endpoint to call' },
    model: { type: 'string', description: 'Model to generate the completion with' },
    systemPrompt: { type: 'string', description: 'System prompt guiding the model' },
    content: { type: 'string', description: 'User message sent to the model' },
    maxTokens: { type: 'number', description: 'Maximum number of tokens to generate' },
    temperature: { type: 'number', description: 'Sampling temperature' },
    topP: { type: 'number', description: 'Nucleus sampling probability mass' },
  },

  outputs: {
    data: {
      type: 'json',
      description: 'Response body from the function (call function operation)',
    },
    status: { type: 'number', description: 'HTTP status code (call function operation)' },
    headers: { type: 'json', description: 'Response headers (call function operation)' },
    content: { type: 'string', description: 'Generated text (chat completion operation)' },
    model: { type: 'string', description: 'Model used (chat completion operation)' },
    finishReason: {
      type: 'string',
      description: 'Why generation stopped (chat completion operation)',
    },
    usage: { type: 'json', description: 'Token usage (chat completion operation)' },
    models: { type: 'json', description: 'Models the token can reach (list models operation)' },
    count: { type: 'number', description: 'Number of models returned (list models operation)' },
  },
}

export const ModalBlockMeta = {
  tags: ['llm', 'cloud', 'agentic'],
  url: 'https://modal.com',
  templates: [
    {
      icon: ModalIcon,
      title: 'Modal GPU inference',
      prompt:
        'Build a workflow where an agent receives a question, calls a deployed Modal Web Function that runs a GPU model, and replies with the model output.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['automation', 'inference'],
    },
    {
      icon: ModalIcon,
      title: 'Modal self-hosted chat',
      prompt:
        'Create a workflow that answers incoming Slack messages by generating a chat completion on a Modal Endpoint running an open-weight model, then posts the reply back to the thread.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['llm', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ModalIcon,
      title: 'Modal batch scoring',
      prompt:
        'Build a scheduled workflow that reads pending rows from a table, calls a deployed Modal function to score each one, and writes the scores back to the table.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['automation', 'data'],
    },
    {
      icon: ModalIcon,
      title: 'Modal document summarizer',
      prompt:
        'Create a workflow that takes an uploaded document, sends its text to a Modal Endpoint for summarization, and emails the summary back to the requester.',
      modules: ['files', 'workflows'],
      category: 'productivity',
      tags: ['llm', 'documents'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: ModalIcon,
      title: 'Modal endpoint health check',
      prompt:
        'Build a scheduled workflow that lists the models a Modal token can reach, sends a short test completion to each one, records the latency in a table, and alerts the engineering channel when an endpoint stops responding.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'engineering',
      tags: ['monitoring', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ModalIcon,
      title: 'Modal image generation',
      prompt:
        'Create a workflow that takes a prompt from a form, calls a deployed Modal function that generates an image, and shares the result in Slack.',
      modules: ['workflows'],
      category: 'marketing',
      tags: ['automation', 'image-generation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ModalIcon,
      title: 'Modal model comparison',
      prompt:
        'Build a workflow that sends the same prompt to two Modal Endpoints, has an agent compare the two completions for accuracy and tone, and writes the verdict to a table.',
      modules: ['agent', 'tables', 'workflows'],
      category: 'engineering',
      tags: ['llm', 'evaluation'],
    },
    {
      icon: ModalIcon,
      title: 'Modal enrichment pipeline',
      prompt:
        'Create a workflow triggered when a new record lands in a table that calls a deployed Modal function to extract structured fields from the raw text, then updates the record with the extracted values.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['enrichment', 'automation'],
    },
  ],
  skills: [
    {
      name: 'call-modal-function',
      description:
        'Invoke a deployed Modal Web Function or Server over HTTPS and use its response. Use when compute lives on Modal rather than in the workflow.',
      content:
        '# Call Modal Function\n\nRun compute that already lives on Modal.\n\n## Steps\n1. Get the function URL from the `modal deploy` output or the Modal dashboard. It looks like `https://<workspace>--<app>-<function>.modal.run`.\n2. Use Call Function with that URL. Pick the method the function expects — POST for a function that reads a JSON body, GET for one that reads query parameters.\n3. If the function is authenticated (Servers require this by default, Web Functions do not), fill in the Token ID and Token Secret from `modal workspace proxy-tokens create`. Leave both empty for an unauthenticated function.\n4. Read the result from the data output. It is parsed JSON when the function responds with `application/json`, and raw text otherwise.\n\n## Output\nReturn what the function produced. If the call fails, report the status code and the error body verbatim rather than retrying blindly — a 401 means the proxy token is missing or not scoped to that environment, and a 503 means a Server has no warm containers yet.',
    },
    {
      name: 'generate-on-modal-endpoint',
      description:
        'Generate a chat completion from an open-weight model served by a Modal Endpoint. Use when inference should run on your own Modal compute.',
      content:
        '# Generate On Modal Endpoint\n\nRun inference on a model you host on Modal.\n\n## Steps\n1. Create a proxy token with `modal workspace proxy-tokens create` and fill in the Token ID and Token Secret. Endpoints are authenticated by default.\n2. Set the Endpoint URL. Use the URL from `modal endpoint list` for a dedicated endpoint, or leave it empty to reach Shared Endpoints through `https://inference.us-west.modal.direct`.\n3. Set the Model. For a dedicated endpoint this is the base model repo ID; for a Shared Endpoint it is the endpoint hostname. Run List Models first when you are unsure which IDs the token can reach.\n4. Write the user message, and add a system prompt when the response needs a fixed format or persona. Set max tokens and temperature in advanced options for long or deterministic outputs.\n\n## Output\nReturn the generated content. Include the finish reason when it is not `stop` — `length` means the response was cut off and max tokens needs raising.',
    },
    {
      name: 'audit-modal-endpoints',
      description:
        'List the models a Modal proxy token can reach and verify each one responds. Use for access audits and endpoint health checks.',
      content:
        '# Audit Modal Endpoints\n\nCheck which models a token reaches and whether they are serving.\n\n## Steps\n1. Use List Models with the token you want to audit. Leave the Endpoint URL empty to enumerate every Shared Endpoint the token can reach, or set it to a specific endpoint URL to inspect just that one.\n2. For each model ID returned, send a short Chat Completion (a one-word prompt with max tokens set low) to confirm it is actually serving.\n3. Record which models responded, which failed, and the error for each failure.\n\n## Output\nReturn the reachable model IDs and the result per model. A 401 means the token is invalid; a 403 on an RBAC workspace means the token is not scoped to that environment and needs `modal workspace proxy-tokens allow`.',
    },
  ],
} as const satisfies BlockMeta
