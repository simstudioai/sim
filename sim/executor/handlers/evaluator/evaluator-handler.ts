import { createLogger } from '@/lib/logs/console-logger'
import { BlockOutput } from '@/blocks/types'
import { executeProviderRequest } from '@/providers'
import { getProviderFromModel } from '@/providers/utils'
import { SerializedBlock } from '@/serializer/types'
import { BlockHandler, ExecutionContext } from '../../types'

const logger = createLogger('EvaluatorBlockHandler')

/**
 * Handler for Evaluator blocks that assess content against criteria.
 */
export class EvaluatorBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === 'evaluator'
  }

  async execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<BlockOutput> {
    const model = inputs.model || 'gpt-4o'
    const providerId = getProviderFromModel(model)

    // Process the content to ensure it's in a suitable format
    let processedContent = ''

    try {
      if (typeof inputs.content === 'string') {
        if (inputs.content.trim().startsWith('[') || inputs.content.trim().startsWith('{')) {
          try {
            const parsed = JSON.parse(inputs.content)
            processedContent = JSON.stringify(parsed, null, 2)
          } catch (e) {
            processedContent = inputs.content
          }
        } else {
          processedContent = inputs.content
        }
      } else if (typeof inputs.content === 'object') {
        processedContent = JSON.stringify(inputs.content, null, 2)
      } else {
        processedContent = String(inputs.content || '')
      }
    } catch (e) {
      logger.error('Error processing content:', e)
      processedContent = String(inputs.content || '')
    }

    // Parse system prompt object with robust error handling
    let systemPromptObj: { systemPrompt: string; responseFormat: any } = {
      systemPrompt: '',
      responseFormat: null,
    }

    const metrics = Array.isArray(inputs.metrics) ? inputs.metrics : []
    const metricDescriptions = metrics
      .map((m: any) => `"${m.name}" (${m.range.min}-${m.range.max}): ${m.description}`)
      .join('\n')

    // Create a response format structure
    const responseProperties: Record<string, any> = {}
    metrics.forEach((m: any) => {
      responseProperties[m.name] = { type: 'number' }
    })

    systemPromptObj = {
      systemPrompt: `You are an evaluation agent. Analyze this content against the metrics and provide scores.
      
    Metrics:
    ${metricDescriptions}

    Content:
    ${processedContent}

    Return a JSON object with each metric name as a key and a numeric score as the value. No explanations, only scores.`,
      responseFormat: {
        name: 'evaluation_response',
        schema: {
          type: 'object',
          properties: responseProperties,
          required: metrics.map((m: any) => m.name),
          additionalProperties: false,
        },
        strict: true,
      },
    }

    // Ensure we have a system prompt
    if (!systemPromptObj.systemPrompt) {
      systemPromptObj.systemPrompt =
        'Evaluate the content and provide scores for each metric as JSON.'
    }

    // Make sure we force JSON output in the request
    const response = await executeProviderRequest(providerId, {
      model: inputs.model,
      systemPrompt: systemPromptObj.systemPrompt,
      responseFormat: systemPromptObj.responseFormat,
      messages: [
        {
          role: 'user',
          content:
            'Please evaluate the content provided in the system prompt. Return ONLY a valid JSON with metric scores.',
        },
      ],
      temperature: inputs.temperature || 0,
      apiKey: inputs.apiKey,
    })

    // Parse response content with robust error handling
    let parsedContent: Record<string, any> = {}
    try {
      const contentStr = response.content.trim()
      let jsonStr = ''

      // Method 1: Extract content between first { and last }
      const fullMatch = contentStr.match(/(\{[\s\S]*\})/) // Regex to find JSON structure
      if (fullMatch) {
        jsonStr = fullMatch[0]
      }
      // Method 2: Try to find and extract just the JSON part
      else if (contentStr.includes('{') && contentStr.includes('}')) {
        const startIdx = contentStr.indexOf('{')
        const endIdx = contentStr.lastIndexOf('}') + 1
        jsonStr = contentStr.substring(startIdx, endIdx)
      }
      // Method 3: Just use the raw content as a last resort
      else {
        jsonStr = contentStr
      }

      // Try to parse the extracted JSON
      try {
        parsedContent = JSON.parse(jsonStr)
      } catch (parseError) {
        logger.error('Failed to parse extracted JSON:', parseError)
        throw new Error('Invalid JSON in response')
      }
    } catch (error) {
      logger.error('Error parsing evaluator response:', error)
      logger.error('Raw response content:', response.content)

      // Fallback to empty object
      parsedContent = {}
    }

    // Extract and process metric scores with proper validation
    const metricScores: Record<string, any> = {}

    try {
      const metrics = Array.isArray(inputs.metrics) ? inputs.metrics : []

      // If we have a successful parse, extract the metrics
      if (Object.keys(parsedContent).length > 0) {
        metrics.forEach((metric: { name: string }) => {
          const metricName = metric.name
          const lowerCaseMetricName = metricName.toLowerCase()

          // Try multiple possible ways the metric might be represented
          if (parsedContent[metricName] !== undefined) {
            metricScores[lowerCaseMetricName] = Number(parsedContent[metricName])
          } else if (parsedContent[metricName.toLowerCase()] !== undefined) {
            metricScores[lowerCaseMetricName] = Number(parsedContent[metricName.toLowerCase()])
          } else if (parsedContent[metricName.toUpperCase()] !== undefined) {
            metricScores[lowerCaseMetricName] = Number(parsedContent[metricName.toUpperCase()])
          } else {
            // Last resort - try to find any key that might contain this metric name
            const matchingKey = Object.keys(parsedContent).find((key) =>
              key.toLowerCase().includes(metricName.toLowerCase())
            )

            if (matchingKey) {
              metricScores[lowerCaseMetricName] = Number(parsedContent[matchingKey])
            } else {
              logger.warn(`Metric "${metricName}" not found in LLM response`)
              metricScores[lowerCaseMetricName] = 0
            }
          }
        })
      } else {
        // If we couldn't parse any content, set all metrics to 0
        metrics.forEach((metric: { name: string }) => {
          metricScores[metric.name.toLowerCase()] = 0
        })
      }
    } catch (e) {
      logger.error('Error extracting metric scores:', e)
    }

    // Create result with metrics as direct fields for easy access
    const result = {
      response: {
        content: inputs.content,
        model: response.model,
        tokens: {
          prompt: response.tokens?.prompt || 0,
          completion: response.tokens?.completion || 0,
          total: response.tokens?.total || 0,
        },
        ...metricScores,
      },
    }

    return result
  }
}
