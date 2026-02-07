import { createLogger } from '@sim/logger'
import { AgentIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { getApiKeyCondition } from '@/blocks/utils'
import {
  getBaseModelProviders,
  getMaxTemperature,
  getProviderIcon,
  getReasoningEffortValuesForModel,
  getThinkingLevelsForModel,
  getVerbosityValuesForModel,
  MODELS_WITH_REASONING_EFFORT,
  MODELS_WITH_THINKING,
  MODELS_WITH_VERBOSITY,
  providers,
  supportsTemperature,
} from '@/providers/utils'
import { useProvidersStore } from '@/stores/providers'
import type { ToolResponse } from '@/tools/types'

const logger = createLogger('AgentBlock')

interface AgentResponse extends ToolResponse {
  output: {
    content: string
    model: string
    tokens?: {
      prompt?: number
      completion?: number
      total?: number
    }
    toolCalls?: {
      list: Array<{
        name: string
        arguments: Record<string, any>
      }>
      count: number
    }
  }
}

// Helper function to get the tool ID from a block type
const getToolIdFromBlock = (blockType: string): string | undefined => {
  try {
    const { getAllBlocks } = require('@/blocks/registry')
    const blocks = getAllBlocks()
    const block = blocks.find(
      (b: { type: string; tools?: { access?: string[] } }) => b.type === blockType
    )
    return block?.tools?.access?.[0]
  } catch (error) {
    logger.error('Error getting tool ID from block', { error })
    return undefined
  }
}

export const AgentBlock: BlockConfig<AgentResponse> = {
  type: 'agent',
  name: 'Agent',
  description: 'Build an agent',
  authMode: AuthMode.ApiKey,
  longDescription:
    'The Agent block is a core workflow block that is a wrapper around an LLM. It takes in system/user prompts and calls an LLM provider. It can also make tool calls by directly containing tools inside of its tool input. It can additionally return structured output.',
  bestPractices: `
  - Prefer using integrations as tools within the agent block over separate integration blocks unless complete determinism needed. 
  - Response Format should be a valid JSON Schema. This determines the output of the agent only if present. Fields can be accessed at root level by the following blocks: e.g. <agent1.field>. If response format is not present, the agent will return the standard outputs: content, model, tokens, toolCalls.
  `,
  docsLink: 'https://docs.sim.ai/blocks/agent',
  category: 'blocks',
  bgColor: 'var(--brand-primary-hex)',
  icon: AgentIcon,
  subBlocks: [
    {
      id: 'messages',
      title: 'Messages',
      type: 'messages-input',
      placeholder: 'Enter messages...',
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert at creating professional, comprehensive LLM agent configurations. Generate or modify a JSON array of messages based on the user's request.

Current messages: {context}

RULES:
1. Generate ONLY a valid JSON array - no markdown, no explanations
2. Each message object must have "role" (system/user/assistant) and "content" (string)
3. You can generate any number of messages as needed
4. Content can be as long as necessary - don't truncate
5. If editing existing messages, preserve structure unless asked to change it
6. For new agents, create DETAILED, PROFESSIONAL system prompts that include:
   - A clear role definition starting with "You are..."
   - Specific methodology or approach guidelines
   - Structured output format requirements
   - Critical thinking or quality guidelines
   - How to handle edge cases and uncertainty

EXAMPLES:

Research agent:
[{"role": "system", "content": "You are a Research Specialist who synthesizes information into actionable insights.\\n\\n## Approach\\n- Identify key concepts, historical context, and future implications\\n- Distinguish between: established facts, emerging research, contested positions, and your inferences\\n- Attribute claims clearly (e.g., \\"Research suggests...\\", \\"Industry consensus holds...\\")\\n\\n## Response Structure\\n1. **Executive Summary**: 2-3 sentences on key findings\\n2. **Key Findings**: Numbered insights with supporting context\\n3. **Analysis**: Organized by themes—background, current state, perspectives, implications\\n4. **Limitations**: What's uncertain or incomplete\\n5. **Recommendations**: Actionable next steps\\n\\n## Standards\\n- Present multiple viewpoints; avoid single narratives as definitive\\n- Make assumptions explicit; question conventional wisdom\\n- Assess evidence strength; distinguish correlation from causation\\n- Use hedging language (\\"likely\\", \\"suggests\\") over false certainty\\n- Acknowledge knowledge limits directly"}, {"role": "user", "content": ""}]

Code reviewer:
[{"role": "system", "content": "You are a Senior Code Reviewer with expertise in software architecture, security, and best practices. Your role is to provide thorough, constructive code reviews that improve code quality and help developers grow.\\n\\n## Review Methodology\\n\\n1. **Security First**: Check for vulnerabilities including injection attacks, authentication flaws, data exposure, and insecure dependencies.\\n\\n2. **Code Quality**: Evaluate readability, maintainability, adherence to DRY/SOLID principles, and appropriate abstraction levels.\\n\\n3. **Performance**: Identify potential bottlenecks, unnecessary computations, memory leaks, and optimization opportunities.\\n\\n4. **Testing**: Assess test coverage, edge case handling, and testability of the code structure.\\n\\n## Output Format\\n\\n### Summary\\nBrief overview of the code's purpose and overall assessment.\\n\\n### Critical Issues\\nSecurity vulnerabilities or bugs that must be fixed before merging.\\n\\n### Improvements\\nSuggested enhancements with clear explanations of why and how.\\n\\n### Positive Aspects\\nHighlight well-written code to reinforce good practices.\\n\\nBe specific with line references. Provide code examples for suggested changes. Balance critique with encouragement."}, {"role": "user", "content": "<start.input>"}]

Writing assistant:
[{"role": "system", "content": "You are a skilled Writing Editor and Coach. Your role is to help users improve their writing through constructive feedback, editing suggestions, and guidance on style, clarity, and structure.\\n\\n## Editing Approach\\n\\n1. **Clarity**: Ensure ideas are expressed clearly and concisely. Eliminate jargon unless appropriate for the audience.\\n\\n2. **Structure**: Evaluate logical flow, paragraph organization, and transitions between ideas.\\n\\n3. **Voice & Tone**: Maintain consistency and appropriateness for the intended audience and purpose.\\n\\n4. **Grammar & Style**: Correct errors while respecting the author's voice.\\n\\n## Output Format\\n\\n### Overall Impression\\nBrief assessment of the piece's strengths and areas for improvement.\\n\\n### Structural Feedback\\nComments on organization, flow, and logical progression.\\n\\n### Line-Level Edits\\nSpecific suggestions with explanations, not just corrections.\\n\\n### Revised Version\\nWhen appropriate, provide an edited version demonstrating improvements.\\n\\nBe encouraging while honest. Explain the reasoning behind suggestions to help the writer improve."}, {"role": "user", "content": "<start.input>"}]

Return ONLY the JSON array.`,
        placeholder: 'Describe what you want to create or change...',
        generationType: 'json-object',
      },
    },
    {
      id: 'model',
      title: 'Model',
      type: 'combobox',
      placeholder: 'Type or select a model...',
      required: true,
      defaultValue: 'claude-sonnet-4-5',
      options: () => {
        const providersState = useProvidersStore.getState()
        const baseModels = providersState.providers.base.models
        const ollamaModels = providersState.providers.ollama.models
        const vllmModels = providersState.providers.vllm.models
        const openrouterModels = providersState.providers.openrouter.models
        const allModels = Array.from(
          new Set([...baseModels, ...ollamaModels, ...vllmModels, ...openrouterModels])
        )

        return allModels.map((model) => {
          const icon = getProviderIcon(model)
          return { label: model, id: model, ...(icon && { icon }) }
        })
      },
    },
    {
      id: 'vertexCredential',
      title: 'Google Cloud Account',
      type: 'oauth-input',
      serviceId: 'vertex-ai',
      requiredScopes: ['https://www.googleapis.com/auth/cloud-platform'],
      placeholder: 'Select Google Cloud account',
      required: true,
      condition: {
        field: 'model',
        value: providers.vertex.models,
      },
    },
    {
      id: 'reasoningEffort',
      title: 'Reasoning Effort',
      type: 'dropdown',
      placeholder: 'Select reasoning effort...',
      options: [
        { label: 'auto', id: 'auto' },
        { label: 'low', id: 'low' },
        { label: 'medium', id: 'medium' },
        { label: 'high', id: 'high' },
      ],
      dependsOn: ['model'],
      fetchOptions: async (blockId: string) => {
        const { useSubBlockStore } = await import('@/stores/workflows/subblock/store')
        const { useWorkflowRegistry } = await import('@/stores/workflows/registry/store')

        const autoOption = { label: 'auto', id: 'auto' }

        const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
        if (!activeWorkflowId) {
          return [
            autoOption,
            { label: 'low', id: 'low' },
            { label: 'medium', id: 'medium' },
            { label: 'high', id: 'high' },
          ]
        }

        const workflowValues = useSubBlockStore.getState().workflowValues[activeWorkflowId]
        const blockValues = workflowValues?.[blockId]
        const modelValue = blockValues?.model as string

        if (!modelValue) {
          return [
            autoOption,
            { label: 'low', id: 'low' },
            { label: 'medium', id: 'medium' },
            { label: 'high', id: 'high' },
          ]
        }

        const validOptions = getReasoningEffortValuesForModel(modelValue)
        if (!validOptions) {
          return [
            autoOption,
            { label: 'low', id: 'low' },
            { label: 'medium', id: 'medium' },
            { label: 'high', id: 'high' },
          ]
        }

        return [autoOption, ...validOptions.map((opt) => ({ label: opt, id: opt }))]
      },
      mode: 'advanced',
      condition: {
        field: 'model',
        value: MODELS_WITH_REASONING_EFFORT,
      },
    },
    {
      id: 'verbosity',
      title: 'Verbosity',
      type: 'dropdown',
      placeholder: 'Select verbosity...',
      options: [
        { label: 'auto', id: 'auto' },
        { label: 'low', id: 'low' },
        { label: 'medium', id: 'medium' },
        { label: 'high', id: 'high' },
      ],
      dependsOn: ['model'],
      fetchOptions: async (blockId: string) => {
        const { useSubBlockStore } = await import('@/stores/workflows/subblock/store')
        const { useWorkflowRegistry } = await import('@/stores/workflows/registry/store')

        const autoOption = { label: 'auto', id: 'auto' }

        const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
        if (!activeWorkflowId) {
          return [
            autoOption,
            { label: 'low', id: 'low' },
            { label: 'medium', id: 'medium' },
            { label: 'high', id: 'high' },
          ]
        }

        const workflowValues = useSubBlockStore.getState().workflowValues[activeWorkflowId]
        const blockValues = workflowValues?.[blockId]
        const modelValue = blockValues?.model as string

        if (!modelValue) {
          return [
            autoOption,
            { label: 'low', id: 'low' },
            { label: 'medium', id: 'medium' },
            { label: 'high', id: 'high' },
          ]
        }

        const validOptions = getVerbosityValuesForModel(modelValue)
        if (!validOptions) {
          return [
            autoOption,
            { label: 'low', id: 'low' },
            { label: 'medium', id: 'medium' },
            { label: 'high', id: 'high' },
          ]
        }

        return [autoOption, ...validOptions.map((opt) => ({ label: opt, id: opt }))]
      },
      mode: 'advanced',
      condition: {
        field: 'model',
        value: MODELS_WITH_VERBOSITY,
      },
    },
    {
      id: 'thinkingLevel',
      title: 'Thinking Level',
      type: 'dropdown',
      placeholder: 'Select thinking level...',
      options: [
        { label: 'none', id: 'none' },
        { label: 'minimal', id: 'minimal' },
        { label: 'low', id: 'low' },
        { label: 'medium', id: 'medium' },
        { label: 'high', id: 'high' },
        { label: 'max', id: 'max' },
      ],
      dependsOn: ['model'],
      fetchOptions: async (blockId: string) => {
        const { useSubBlockStore } = await import('@/stores/workflows/subblock/store')
        const { useWorkflowRegistry } = await import('@/stores/workflows/registry/store')

        const noneOption = { label: 'none', id: 'none' }

        const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
        if (!activeWorkflowId) {
          return [noneOption, { label: 'low', id: 'low' }, { label: 'high', id: 'high' }]
        }

        const workflowValues = useSubBlockStore.getState().workflowValues[activeWorkflowId]
        const blockValues = workflowValues?.[blockId]
        const modelValue = blockValues?.model as string

        if (!modelValue) {
          return [noneOption, { label: 'low', id: 'low' }, { label: 'high', id: 'high' }]
        }

        const validOptions = getThinkingLevelsForModel(modelValue)
        if (!validOptions) {
          return [noneOption, { label: 'low', id: 'low' }, { label: 'high', id: 'high' }]
        }

        return [noneOption, ...validOptions.map((opt) => ({ label: opt, id: opt }))]
      },
      mode: 'advanced',
      condition: {
        field: 'model',
        value: MODELS_WITH_THINKING,
      },
    },

    {
      id: 'azureEndpoint',
      title: 'Azure Endpoint',
      type: 'short-input',
      password: true,
      placeholder: 'https://your-resource.services.ai.azure.com',
      connectionDroppable: false,
      condition: {
        field: 'model',
        value: [...providers['azure-openai'].models, ...providers['azure-anthropic'].models],
      },
    },
    {
      id: 'azureApiVersion',
      title: 'Azure API Version',
      type: 'short-input',
      placeholder: 'Enter API version',
      connectionDroppable: false,
      condition: {
        field: 'model',
        value: [...providers['azure-openai'].models, ...providers['azure-anthropic'].models],
      },
    },
    {
      id: 'vertexProject',
      title: 'Vertex AI Project',
      type: 'short-input',
      placeholder: 'your-gcp-project-id',
      connectionDroppable: false,
      required: true,
      condition: {
        field: 'model',
        value: providers.vertex.models,
      },
    },
    {
      id: 'vertexLocation',
      title: 'Vertex AI Location',
      type: 'short-input',
      placeholder: 'us-central1',
      connectionDroppable: false,
      required: true,
      condition: {
        field: 'model',
        value: providers.vertex.models,
      },
    },
    {
      id: 'bedrockAccessKeyId',
      title: 'AWS Access Key ID',
      type: 'short-input',
      password: true,
      placeholder: 'Enter your AWS Access Key ID',
      connectionDroppable: false,
      required: true,
      condition: {
        field: 'model',
        value: providers.bedrock.models,
      },
    },
    {
      id: 'bedrockSecretKey',
      title: 'AWS Secret Access Key',
      type: 'short-input',
      password: true,
      placeholder: 'Enter your AWS Secret Access Key',
      connectionDroppable: false,
      required: true,
      condition: {
        field: 'model',
        value: providers.bedrock.models,
      },
    },
    {
      id: 'bedrockRegion',
      title: 'AWS Region',
      type: 'short-input',
      placeholder: 'us-east-1',
      connectionDroppable: false,
      condition: {
        field: 'model',
        value: providers.bedrock.models,
      },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your API key',
      password: true,
      connectionDroppable: false,
      required: true,
      condition: getApiKeyCondition(),
    },
    {
      id: 'tools',
      title: 'Tools',
      type: 'tool-input',
      defaultValue: [],
    },
    {
      id: 'skills',
      title: 'Skills',
      type: 'skill-input',
      defaultValue: [],
    },
    {
      id: 'memoryType',
      title: 'Memory',
      type: 'dropdown',
      placeholder: 'Select memory...',
      options: [
        { label: 'None', id: 'none' },
        { label: 'Conversation', id: 'conversation' },
        { label: 'Sliding window (messages)', id: 'sliding_window' },
        { label: 'Sliding window (tokens)', id: 'sliding_window_tokens' },
      ],
      defaultValue: 'none',
    },
    {
      id: 'conversationId',
      title: 'Conversation ID',
      type: 'short-input',
      placeholder: 'e.g., user-123, session-abc, customer-456',
      required: {
        field: 'memoryType',
        value: ['conversation', 'sliding_window', 'sliding_window_tokens'],
      },
      condition: {
        field: 'memoryType',
        value: ['conversation', 'sliding_window', 'sliding_window_tokens'],
      },
    },
    {
      id: 'slidingWindowSize',
      title: 'Sliding Window Size',
      type: 'short-input',
      placeholder: 'Enter number of messages (e.g., 10)...',
      condition: {
        field: 'memoryType',
        value: ['sliding_window'],
      },
    },
    {
      id: 'slidingWindowTokens',
      title: 'Max Tokens',
      type: 'short-input',
      placeholder: 'Enter max tokens (e.g., 4000)...',
      condition: {
        field: 'memoryType',
        value: ['sliding_window_tokens'],
      },
    },
    {
      id: 'temperature',
      title: 'Temperature',
      type: 'slider',
      min: 0,
      max: 1,
      defaultValue: 0.3,
      mode: 'advanced',
      condition: () => ({
        field: 'model',
        value: (() => {
          const allModels = Object.keys(getBaseModelProviders())
          return allModels.filter(
            (model) => supportsTemperature(model) && getMaxTemperature(model) === 1
          )
        })(),
      }),
    },
    {
      id: 'temperature',
      title: 'Temperature',
      type: 'slider',
      min: 0,
      max: 2,
      defaultValue: 0.3,
      mode: 'advanced',
      condition: () => ({
        field: 'model',
        value: (() => {
          const allModels = Object.keys(getBaseModelProviders())
          return allModels.filter(
            (model) => supportsTemperature(model) && getMaxTemperature(model) === 2
          )
        })(),
      }),
    },
    {
      id: 'maxTokens',
      title: 'Max Output Tokens',
      type: 'short-input',
      placeholder: 'Enter max tokens (e.g., 4096)...',
      mode: 'advanced',
    },
    {
      id: 'responseFormat',
      title: 'Response Format',
      type: 'code',
      placeholder: 'Enter JSON schema...',
      language: 'json',
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert programmer specializing in creating JSON schemas according to a specific format.
Generate ONLY the JSON schema based on the user's request.
The output MUST be a single, valid JSON object, starting with { and ending with }.
The JSON object MUST have the following top-level properties: 'name' (string), 'description' (string), 'strict' (boolean, usually true), and 'schema' (object).
The 'schema' object must define the structure and MUST contain 'type': 'object', 'properties': {...}, 'additionalProperties': false, and 'required': [...].
Inside 'properties', use standard JSON Schema properties (type, description, enum, items for arrays, etc.).

Current schema: {context}

Do not include any explanations, markdown formatting, or other text outside the JSON object.

Valid Schema Examples:

Example 1:
{
    "name": "reddit_post",
    "description": "Fetches the reddit posts in the given subreddit",
    "strict": true,
    "schema": {
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "The title of the post"
            },
            "content": {
                "type": "string",
                "description": "The content of the post"
            }
        },
        "additionalProperties": false,
        "required": [ "title", "content" ]
    }
}

Example 2:
{
    "name": "get_weather",
    "description": "Fetches the current weather for a specific location.",
    "strict": true,
    "schema": {
        "type": "object",
        "properties": {
            "location": {
                "type": "string",
                "description": "The city and state, e.g., San Francisco, CA"
            },
            "unit": {
                "type": "string",
                "description": "Temperature unit",
                "enum": ["celsius", "fahrenheit"]
            }
        },
        "additionalProperties": false,
        "required": ["location", "unit"]
    }
}

Example 3 (Array Input):
{
    "name": "process_items",
    "description": "Processes a list of items with specific IDs.",
    "strict": true,
    "schema": {
        "type": "object",
        "properties": {
            "item_ids": {
                "type": "array",
                "description": "A list of unique item identifiers to process.",
                "items": {
                    "type": "string",
                    "description": "An item ID"
                }
            },
            "processing_mode": {
                "type": "string",
                "description": "The mode for processing",
                "enum": ["fast", "thorough"]
            }
        },
        "additionalProperties": false,
        "required": ["item_ids", "processing_mode"]
    }
}
`,
        placeholder: 'Describe the JSON schema structure you need...',
        generationType: 'json-schema',
      },
    },
  ],
  tools: {
    access: [
      'openai_chat',
      'anthropic_chat',
      'google_chat',
      'xai_chat',
      'deepseek_chat',
      'deepseek_reasoner',
    ],
    config: {
      tool: (params: Record<string, any>) => {
        const model = params.model || 'claude-sonnet-4-5'
        if (!model) {
          throw new Error('No model selected')
        }
        const tool = getBaseModelProviders()[model]
        if (!tool) {
          throw new Error(`Invalid model selected: ${model}`)
        }
        return tool
      },
      params: (params: Record<string, any>) => {
        // If tools array is provided, handle tool usage control
        if (params.tools && Array.isArray(params.tools)) {
          // Transform tools to include usageControl
          const transformedTools = params.tools
            // Filter out tools set to 'none' - they should never be passed to the provider
            .filter((tool: any) => {
              const usageControl = tool.usageControl || 'auto'
              return usageControl !== 'none'
            })
            .map((tool: any) => {
              const toolConfig = {
                id:
                  tool.type === 'custom-tool'
                    ? tool.schema?.function?.name
                    : tool.operation || getToolIdFromBlock(tool.type),
                name: tool.title,
                description: tool.type === 'custom-tool' ? tool.schema?.function?.description : '',
                params: tool.params || {},
                parameters: tool.type === 'custom-tool' ? tool.schema?.function?.parameters : {},
                usageControl: tool.usageControl || 'auto',
                type: tool.type,
              }
              return toolConfig
            })

          // Log which tools are being passed and which are filtered out
          const filteredOutTools = params.tools
            .filter((tool: any) => (tool.usageControl || 'auto') === 'none')
            .map((tool: any) => tool.title)

          if (filteredOutTools.length > 0) {
            logger.info('Filtered out tools set to none', { tools: filteredOutTools.join(', ') })
          }

          return { ...params, tools: transformedTools }
        }
        return params
      },
    },
  },
  inputs: {
    messages: {
      type: 'json',
      description:
        'Array of message objects with role and content: [{ role: "system", content: "..." }, { role: "user", content: "..." }]',
    },
    memoryType: {
      type: 'string',
      description:
        'Type of memory to use: none, conversation, sliding_window, or sliding_window_tokens',
    },
    conversationId: {
      type: 'string',
      description:
        'Specific conversation ID to retrieve memories from (when memoryType is conversation_id)',
    },
    slidingWindowSize: {
      type: 'string',
      description:
        'Number of recent messages to include (when memoryType is sliding_window, e.g., "10")',
    },
    slidingWindowTokens: {
      type: 'string',
      description:
        'Maximum number of tokens for token-based sliding window memory (when memoryType is sliding_window_tokens, e.g., "4000")',
    },
    model: { type: 'string', description: 'AI model to use' },
    apiKey: { type: 'string', description: 'Provider API key' },
    azureEndpoint: { type: 'string', description: 'Azure endpoint URL' },
    azureApiVersion: { type: 'string', description: 'Azure API version' },
    vertexProject: { type: 'string', description: 'Google Cloud project ID for Vertex AI' },
    vertexLocation: { type: 'string', description: 'Google Cloud location for Vertex AI' },
    bedrockAccessKeyId: { type: 'string', description: 'AWS Access Key ID for Bedrock' },
    bedrockSecretKey: { type: 'string', description: 'AWS Secret Access Key for Bedrock' },
    bedrockRegion: { type: 'string', description: 'AWS region for Bedrock' },
    responseFormat: {
      type: 'json',
      description: 'JSON response format schema',
      schema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'A name for your schema (optional)',
          },
          schema: {
            type: 'object',
            description: 'The JSON Schema definition',
            properties: {
              type: {
                type: 'string',
                enum: ['object'],
                description: 'Must be "object" for a valid JSON Schema',
              },
              properties: {
                type: 'object',
                description: 'Object containing property definitions',
              },
              required: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of required property names',
              },
              additionalProperties: {
                type: 'boolean',
                description: 'Whether additional properties are allowed',
              },
            },
            required: ['type', 'properties'],
          },
          strict: {
            type: 'boolean',
            description: 'Whether to enforce strict schema validation',
            default: true,
          },
        },
        required: ['schema'],
      },
    },
    temperature: { type: 'number', description: 'Response randomness level' },
    maxTokens: { type: 'number', description: 'Maximum number of tokens in the response' },
    reasoningEffort: { type: 'string', description: 'Reasoning effort level for GPT-5 models' },
    verbosity: { type: 'string', description: 'Verbosity level for GPT-5 models' },
    thinkingLevel: {
      type: 'string',
      description: 'Thinking level for models with extended thinking (Anthropic Claude, Gemini 3)',
    },
    tools: { type: 'json', description: 'Available tools configuration' },
    skills: { type: 'json', description: 'Selected skills configuration' },
  },
  outputs: {
    content: { type: 'string', description: 'Generated response content' },
    model: { type: 'string', description: 'Model used for generation' },
    tokens: { type: 'json', description: 'Token usage statistics' },
    toolCalls: { type: 'json', description: 'Tool calls made' },
    providerTiming: {
      type: 'json',
      description: 'Provider timing information',
    },
    cost: { type: 'json', description: 'Cost of the API call' },
  },
}
