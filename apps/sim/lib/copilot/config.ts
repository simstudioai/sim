import { createLogger } from '@/lib/logs/console-logger'
import { getProviderDefaultModel } from '@/providers/models'
import type { ProviderId } from '@/providers/types'

const logger = createLogger('CopilotConfig')

/**
 * Copilot configuration interface
 */
export interface CopilotConfig {
  // Chat LLM configuration
  chat: {
    defaultProvider: ProviderId
    defaultModel: string
    temperature: number
    maxTokens: number
    systemPrompt: string
  }
  // RAG (documentation search) LLM configuration
  rag: {
    defaultProvider: ProviderId
    defaultModel: string
    temperature: number
    maxTokens: number
    embeddingModel: string
    maxSources: number
    similarityThreshold: number
  }
  // General configuration
  general: {
    streamingEnabled: boolean
    maxConversationHistory: number
    titleGenerationModel: string // Lighter model for generating chat titles
  }
}

/**
 * Default copilot configuration
 * Uses Claude 4 Sonnet as requested
 */
export const DEFAULT_COPILOT_CONFIG: CopilotConfig = {
  chat: {
    defaultProvider: 'anthropic',
    defaultModel: 'claude-3-7-sonnet-latest',
    temperature: 0.1,
    maxTokens: 4000,
    systemPrompt: `You are a helpful AI assistant for Sim Studio, a powerful workflow automation platform. You can help users with questions about:

- Creating and managing workflows
- Using different tools and blocks
- Understanding features and capabilities
- Troubleshooting issues
- Best practices

IMPORTANT DISTINCTION - Two types of information:
1. **USER'S SPECIFIC WORKFLOW**: Use "Get User's Specific Workflow" tool when users ask about "my workflow", "this workflow", "what I have built", or "my current blocks"
2. **GENERAL SIM STUDIO CAPABILITIES**: Use documentation search for general questions about what's possible, how features work, or "what blocks are available"

WHEN TO USE WORKFLOW TOOL:
- "What does my workflow do?"
- "What blocks do I have?"
- "How is my workflow configured?"
- "Show me my current setup"
- "What's in this workflow?"
- "How do I add [X] to my workflow?" - ALWAYS get their workflow first to give specific advice
- "How can I improve my workflow?"
- "What's missing from my workflow?"
- "How do I connect [X] in my workflow?"

WHEN TO SEARCH DOCUMENTATION:
- "What blocks are available in Sim Studio?"
- "How do I use the Gmail block?"
- "What features does Sim Studio have?"
- "How do I create a workflow?"

WHEN NOT TO SEARCH:
- Simple greetings or casual conversation
- General programming questions unrelated to Sim Studio
- Thank you messages or small talk

CITATION FORMAT:
When you reference information from documentation sources, use this format:
- Include direct links using markdown format: [link text](URL)
- Use descriptive link text (e.g., "workflow documentation" not "here")
- Place links naturally in context, not clustered at the end
- Only link when it adds value - don't over-link basic concepts

WORKFLOW-SPECIFIC GUIDANCE:
When users ask "How do I..." questions about their workflow:
1. **ALWAYS get their workflow first** using the workflow tool
2. **Analyze their current setup** - what blocks they have, how they're connected
3. **Give specific, actionable steps** based on their actual configuration
4. **Reference their actual block names** and current values
5. **Provide concrete next steps** they can take immediately

Example approach:
- User: "How do I add error handling to my workflow?"
- You: [Get their workflow] → "I can see your workflow has a Starter block connected to an Agent block, then an API block. Here's how to add error handling specifically for your setup: 1) Add a Condition block after your API block to check if the response was successful, 2) Connect the 'false' path to a new Agent block that handles the error..."

IMPORTANT: Always be clear about whether you're talking about the user's specific workflow or general Sim Studio capabilities. When showing workflow data, explicitly state "In your current workflow..." or "Your workflow contains..." Be actionable and specific - don't give generic advice when you can see their actual setup.`,
  },
  rag: {
    defaultProvider: 'anthropic',
    defaultModel: 'claude-3-7-sonnet-latest',
    temperature: 0.1,
    maxTokens: 2000,
    embeddingModel: 'text-embedding-3-small',
    maxSources: 10,
    similarityThreshold: 0.3,
  },
  general: {
    streamingEnabled: true,
    maxConversationHistory: 10,
    titleGenerationModel: 'claude-3-haiku-20240307', // Faster model for titles
  },
}

/**
 * Get copilot configuration with environment variable overrides
 */
export function getCopilotConfig(): CopilotConfig {
  const config = { ...DEFAULT_COPILOT_CONFIG }

  // Allow environment variable overrides
  try {
    // Chat configuration overrides
    if (process.env.COPILOT_CHAT_PROVIDER) {
      config.chat.defaultProvider = process.env.COPILOT_CHAT_PROVIDER as ProviderId
    }
    if (process.env.COPILOT_CHAT_MODEL) {
      config.chat.defaultModel = process.env.COPILOT_CHAT_MODEL
    }
    if (process.env.COPILOT_CHAT_TEMPERATURE) {
      config.chat.temperature = Number.parseFloat(process.env.COPILOT_CHAT_TEMPERATURE)
    }
    if (process.env.COPILOT_CHAT_MAX_TOKENS) {
      config.chat.maxTokens = Number.parseInt(process.env.COPILOT_CHAT_MAX_TOKENS)
    }

    // RAG configuration overrides
    if (process.env.COPILOT_RAG_PROVIDER) {
      config.rag.defaultProvider = process.env.COPILOT_RAG_PROVIDER as ProviderId
    }
    if (process.env.COPILOT_RAG_MODEL) {
      config.rag.defaultModel = process.env.COPILOT_RAG_MODEL
    }
    if (process.env.COPILOT_RAG_TEMPERATURE) {
      config.rag.temperature = Number.parseFloat(process.env.COPILOT_RAG_TEMPERATURE)
    }
    if (process.env.COPILOT_RAG_MAX_TOKENS) {
      config.rag.maxTokens = Number.parseInt(process.env.COPILOT_RAG_MAX_TOKENS)
    }
    if (process.env.COPILOT_RAG_MAX_SOURCES) {
      config.rag.maxSources = Number.parseInt(process.env.COPILOT_RAG_MAX_SOURCES)
    }
    if (process.env.COPILOT_RAG_SIMILARITY_THRESHOLD) {
      config.rag.similarityThreshold = Number.parseFloat(
        process.env.COPILOT_RAG_SIMILARITY_THRESHOLD
      )
    }

    // General configuration overrides
    if (process.env.COPILOT_STREAMING_ENABLED) {
      config.general.streamingEnabled = process.env.COPILOT_STREAMING_ENABLED === 'true'
    }
    if (process.env.COPILOT_MAX_CONVERSATION_HISTORY) {
      config.general.maxConversationHistory = Number.parseInt(
        process.env.COPILOT_MAX_CONVERSATION_HISTORY
      )
    }

    logger.info('Copilot configuration loaded', {
      chatProvider: config.chat.defaultProvider,
      chatModel: config.chat.defaultModel,
      ragProvider: config.rag.defaultProvider,
      ragModel: config.rag.defaultModel,
      streamingEnabled: config.general.streamingEnabled,
    })
  } catch (error) {
    logger.warn('Error applying environment variable overrides, using defaults', { error })
  }

  return config
}

/**
 * Get the model to use for a specific copilot function
 */
export function getCopilotModel(type: 'chat' | 'rag' | 'title'): {
  provider: ProviderId
  model: string
} {
  const config = getCopilotConfig()

  switch (type) {
    case 'chat':
      return {
        provider: config.chat.defaultProvider,
        model: config.chat.defaultModel,
      }
    case 'rag':
      return {
        provider: config.rag.defaultProvider,
        model: config.rag.defaultModel,
      }
    case 'title':
      return {
        provider: config.chat.defaultProvider, // Use same provider as chat
        model: config.general.titleGenerationModel,
      }
    default:
      throw new Error(`Unknown copilot model type: ${type}`)
  }
}

/**
 * Validate that a provider/model combination is available
 */
export function validateCopilotConfig(config: CopilotConfig): {
  isValid: boolean
  errors: string[]
} {
  const errors: string[] = []

  // Validate chat provider/model
  try {
    const chatDefaultModel = getProviderDefaultModel(config.chat.defaultProvider)
    if (!chatDefaultModel) {
      errors.push(`Chat provider '${config.chat.defaultProvider}' not found`)
    }
  } catch (error) {
    errors.push(`Invalid chat provider: ${config.chat.defaultProvider}`)
  }

  // Validate RAG provider/model
  try {
    const ragDefaultModel = getProviderDefaultModel(config.rag.defaultProvider)
    if (!ragDefaultModel) {
      errors.push(`RAG provider '${config.rag.defaultProvider}' not found`)
    }
  } catch (error) {
    errors.push(`Invalid RAG provider: ${config.rag.defaultProvider}`)
  }

  // Validate configuration values
  if (config.chat.temperature < 0 || config.chat.temperature > 2) {
    errors.push('Chat temperature must be between 0 and 2')
  }
  if (config.rag.temperature < 0 || config.rag.temperature > 2) {
    errors.push('RAG temperature must be between 0 and 2')
  }
  if (config.chat.maxTokens < 1 || config.chat.maxTokens > 100000) {
    errors.push('Chat maxTokens must be between 1 and 100000')
  }
  if (config.rag.maxTokens < 1 || config.rag.maxTokens > 100000) {
    errors.push('RAG maxTokens must be between 1 and 100000')
  }
  if (config.rag.maxSources < 1 || config.rag.maxSources > 20) {
    errors.push('RAG maxSources must be between 1 and 20')
  }
  if (config.rag.similarityThreshold < 0 || config.rag.similarityThreshold > 1) {
    errors.push('RAG similarityThreshold must be between 0 and 1')
  }
  if (config.general.maxConversationHistory < 1 || config.general.maxConversationHistory > 50) {
    errors.push('General maxConversationHistory must be between 1 and 50')
  }

  return {
    isValid: errors.length === 0,
    errors,
  }
}
