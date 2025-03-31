import { ChartBarIcon } from '@/components/icons'
import { createLogger } from '@/lib/logs/console-logger'
import { useOllamaStore } from '@/stores/ollama/store'
import { ProviderId } from '@/providers/types'
import { getAllModelProviders, getBaseModelProviders } from '@/providers/utils'
import { ToolResponse } from '@/tools/types'
import { BlockConfig, ParamType } from '../types'

const logger = createLogger('EvaluatorBlock')

interface Metric {
  name: string
  description: string
  range: {
    min: number
    max: number
  }
}

interface EvaluatorResponse extends ToolResponse {
  output: {
    content: string
    model: string
    tokens?: {
      prompt?: number
      completion?: number
      total?: number
    }
    [metricName: string]: any // Allow dynamic metric fields
  }
}

export const generateEvaluatorPrompt = (metrics: Metric[], content: string): string => {
  // Create a clear metrics description with name, range, and description
  const metricsDescription = metrics
    .map(
      (metric) =>
        `"${metric.name}" (${metric.range.min}-${metric.range.max}): ${metric.description}`
    )
    .join('\n')

  // Format the content properly - try to detect and format JSON
  let formattedContent = content
  try {
    // If content looks like JSON (starts with { or [)
    if (
      typeof content === 'string' &&
      (content.trim().startsWith('{') || content.trim().startsWith('['))
    ) {
      // Try to parse and pretty-print
      const parsedContent = JSON.parse(content)
      formattedContent = JSON.stringify(parsedContent, null, 2)
    }
    // If it's already an object (shouldn't happen here but just in case)
    else if (typeof content === 'object') {
      formattedContent = JSON.stringify(content, null, 2)
    }
  } catch (e) {
    logger.warn('Warning: Content may not be valid JSON, using as-is', { e })
    formattedContent = content
  }

  // Generate an example of the expected output format
  const exampleOutput = metrics.reduce(
    (acc, metric) => {
      acc[metric.name.toLowerCase()] = Math.floor((metric.range.min + metric.range.max) / 2) // Use middle of range as example
      return acc
    },
    {} as Record<string, number>
  )

  return `You are an objective evaluation agent. Analyze the content against the provided metrics and provide detailed scoring.

Evaluation Instructions:
- You MUST evaluate the content against each metric
- For each metric, provide a numeric score within the specified range
- Your response MUST be a valid JSON object with each metric name as a key and a numeric score as the value
- IMPORTANT: Use lowercase versions of the metric names as keys in your JSON response
- Follow the exact schema of the response format provided to you
- Do not include explanations in the JSON - only numeric scores
- Do not add any additional fields not specified in the schema
- Do not include ANY text before or after the JSON object

Metrics to evaluate:
${metricsDescription}

Content to evaluate:
${formattedContent}

Example of expected response format (with different scores):
${JSON.stringify(exampleOutput, null, 2)}

Remember: Your response MUST be a valid JSON object containing only the lowercase metric names as keys with their numeric scores as values. No text explanations.`
}

// Simplified response format generator that matches the agent block schema structure
const generateResponseFormat = (metrics: Metric[]) => {
  // Create properties for each metric
  const properties: Record<string, any> = {}

  // Add each metric as a property
  metrics.forEach((metric) => {
    properties[metric.name.toLowerCase()] = {
      type: 'number',
      description: `${metric.description} (Score between ${metric.range.min}-${metric.range.max})`,
    }
  })

  // Return a proper JSON Schema format
  return {
    name: 'evaluation_response',
    schema: {
      type: 'object',
      properties,
      required: metrics.map((metric) => metric.name.toLowerCase()),
      additionalProperties: false,
    },
    strict: true,
  }
}

export const EvaluatorBlock: BlockConfig<EvaluatorResponse> = {
  type: 'evaluator',
  name: 'Evaluator',
  description: 'Evaluate content',
  longDescription:
    'Assess content quality using customizable evaluation metrics and scoring criteria. Create objective evaluation frameworks with numeric scoring to measure performance across multiple dimensions.',
  category: 'tools',
  bgColor: '#4D5FFF',
  icon: ChartBarIcon,
  subBlocks: [
    {
      id: 'metrics',
      title: 'Evaluation Metrics',
      type: 'eval-input',
      layout: 'full',
    },
    {
      id: 'content',
      title: 'Content',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter the content to evaluate',
    },
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      layout: 'half',
      options: () => {
        const ollamaModels = useOllamaStore.getState().models
        const baseModels = Object.keys(getBaseModelProviders())
        return [...baseModels, ...ollamaModels]
      },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your API key',
      password: true,
      connectionDroppable: false,
    },
    {
      id: 'systemPrompt',
      title: 'System Prompt',
      type: 'code',
      layout: 'full',
      hidden: true,
      value: (params: Record<string, any>) => {
        try {
          const metrics = params.metrics || []

          // Process content safely
          let processedContent = ''
          if (typeof params.content === 'object') {
            processedContent = JSON.stringify(params.content, null, 2)
          } else {
            processedContent = String(params.content || '')
          }

          // Generate prompt and response format directly
          const promptText = generateEvaluatorPrompt(metrics, processedContent)
          const responseFormatObj = generateResponseFormat(metrics)

          // Create a clean, simple JSON object
          const result = {
            systemPrompt: promptText,
            responseFormat: responseFormatObj,
          }

          return JSON.stringify(result)
        } catch (e) {
          logger.error('Error in systemPrompt value function:', { e })
          // Return a minimal valid JSON as fallback
          return JSON.stringify({
            systemPrompt: 'Evaluate the content and return a JSON with metric scores.',
            responseFormat: {
              schema: {
                type: 'object',
                properties: {},
                additionalProperties: true,
              },
            },
          })
        }
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
        const model = params.model || 'gpt-4o'
        if (!model) {
          throw new Error('No model selected')
        }
        const tool = getAllModelProviders()[model as ProviderId]
        if (!tool) {
          throw new Error(`Invalid model selected: ${model}`)
        }
        return tool
      },
    },
  },
  inputs: {
    metrics: {
      type: 'json' as ParamType,
      required: true,
      description: 'Array of metrics to evaluate against',
      schema: {
        type: 'array',
        properties: {},
        items: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Name of the metric',
            },
            description: {
              type: 'string',
              description: 'Description of what this metric measures',
            },
            range: {
              type: 'object',
              properties: {
                min: {
                  type: 'number',
                  description: 'Minimum possible score',
                },
                max: {
                  type: 'number',
                  description: 'Maximum possible score',
                },
              },
              required: ['min', 'max'],
            },
          },
          required: ['name', 'description', 'range'],
        },
      },
    },
    model: { type: 'string' as ParamType, required: true },
    apiKey: { type: 'string' as ParamType, required: true },
    content: { type: 'string' as ParamType, required: true },
  },
  outputs: {
    response: {
      type: {
        content: 'string',
        model: 'string',
        tokens: 'any',
      },
      dependsOn: {
        subBlockId: 'metrics',
        condition: {
          whenEmpty: {
            content: 'string',
            model: 'string',
            tokens: 'any',
          },
          whenFilled: 'json',
        },
      },
    },
  },
}
