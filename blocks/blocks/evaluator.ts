import { ChartBarIcon } from '@/components/icons'
import { MODEL_PROVIDERS } from '@/providers/consts'
import { ProviderId } from '@/providers/registry'
import { ToolResponse } from '@/tools/types'
import { BlockConfig, ParamType } from '../types'

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
  const metricsDescription = metrics
    .map(
      (metric) => `${metric.name} (${metric.range.min}-${metric.range.max}): ${metric.description}`
    )
    .join('\n')

  return `You are an objective evaluation agent. Analyze the content against the provided metrics and provide detailed scoring.

Evaluation Instructions:
- For each metric, provide a numeric score within the specified range
- Your response must be a valid JSON object with each metric as a number field
- Do not include explanations in the JSON - only numeric scores
- Under any circumstances, do not include any text before or after the JSON object
Metrics to evaluate:
${metricsDescription}

Content to evaluate:
${content}`
}

// Simplified response format generator that matches the agent block schema structure
const generateResponseFormat = (metrics: Metric[]) => ({
  fields: metrics.map((metric) => ({
    name: metric.name,
    type: 'number',
    description: `${metric.description} (Score between ${metric.range.min}-${metric.range.max})`,
  })),
})

export const EvaluatorBlock: BlockConfig<EvaluatorResponse> = {
  type: 'evaluator',
  name: 'Evaluator',
  description: 'Evaluate content',
  category: 'blocks',
  bgColor: '#2FA1FF',
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
      options: Object.keys(MODEL_PROVIDERS),
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
        const metrics = params.metrics || []
        const content = params.content || ''
        const responseFormat = generateResponseFormat(metrics)

        return JSON.stringify({
          systemPrompt: generateEvaluatorPrompt(metrics, content),
          responseFormat,
        })
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
        const tool = MODEL_PROVIDERS[model as ProviderId]
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
