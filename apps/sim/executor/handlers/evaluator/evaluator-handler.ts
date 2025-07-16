import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console-logger'
import type { BlockOutput } from '@/blocks/types'
import { BlockType } from '@/executor/consts'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import { calculateCost, getProviderFromModel } from '@/providers/utils'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('EvaluatorBlockHandler')

/**
 * Handler for Evaluator blocks that assess content against criteria.
 */
export class EvaluatorBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.EVALUATOR
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
          } catch (_e) {
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

    logger.info('Inputs for evaluator:', inputs)
    const metrics = Array.isArray(inputs.metrics) ? inputs.metrics : []
    logger.info('Metrics for evaluator:', metrics)
    const metricDescriptions = metrics
      .filter((m: any) => m?.name && m.range) // Filter out invalid/incomplete metrics
      .map((m: any) => `"${m.name}" (${m.range.min}-${m.range.max}): ${m.description || ''}`)
      .join('\n')

    // Create a response format structure
    const responseProperties: Record<string, any> = {}
    metrics.forEach((m: any) => {
      // Ensure metric and name are valid before using them
      if (m?.name) {
        responseProperties[m.name.toLowerCase()] = { type: 'number' } // Use lowercase for consistency
      } else {
        logger.warn('Skipping invalid metric entry during response format generation:', m)
      }
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
          // Filter out invalid names before creating the required array
          required: metrics.filter((m: any) => m?.name).map((m: any) => m.name.toLowerCase()),
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

    try {
      const baseUrl = env.NEXT_PUBLIC_APP_URL || ''
      const url = new URL('/api/providers', baseUrl)

      // Make sure we force JSON output in the request
      const providerRequest = {
        provider: providerId,
        model: model,
        systemPrompt: systemPromptObj.systemPrompt,
        responseFormat: systemPromptObj.responseFormat,
        context: JSON.stringify([
          {
            role: 'user',
            content:
              'Please evaluate the content provided in the system prompt. Return ONLY a valid JSON with metric scores.',
          },
        ]),
        temperature: inputs.temperature || 0,
        apiKey: inputs.apiKey,
        workflowId: context.workflowId,
      }

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(providerRequest),
      })

      if (!response.ok) {
        // Try to extract a helpful error message
        let errorMessage = `Provider API request failed with status ${response.status}`
        try {
          const errorData = await response.json()
          if (errorData.error) {
            errorMessage = errorData.error
          }
        } catch (_e) {
          // If JSON parsing fails, use the original error message
        }
        throw new Error(errorMessage)
      }

      const result = await response.json()

      // Parse response content with robust error handling
      let parsedContent: Record<string, any> = {}
      try {
        const contentStr = result.content.trim()
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
        logger.error('Raw response content:', result.content)

        // Fallback to empty object
        parsedContent = {}
      }

      // Extract and process metric scores with proper validation
      const metricScores: Record<string, any> = {}

      try {
        // Ensure metrics is an array before processing
        const validMetrics = Array.isArray(inputs.metrics) ? inputs.metrics : []

        // If we have a successful parse, extract the metrics
        if (Object.keys(parsedContent).length > 0) {
          validMetrics.forEach((metric: any) => {
            // Check if metric and name are valid before proceeding
            if (!metric || !metric.name) {
              logger.warn('Skipping invalid metric entry during score extraction:', metric)
              return // Skip this iteration
            }

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
              const matchingKey = Object.keys(parsedContent).find((key) => {
                // Add check for key validity before calling toLowerCase()
                return typeof key === 'string' && key.toLowerCase().includes(lowerCaseMetricName)
              })

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
          validMetrics.forEach((metric: any) => {
            // Ensure metric and name are valid before setting default score
            if (metric?.name) {
              metricScores[metric.name.toLowerCase()] = 0
            } else {
              logger.warn('Skipping invalid metric entry when setting default scores:', metric)
            }
          })
        }
      } catch (e) {
        logger.error('Error extracting metric scores:', e)
      }

      // Calculate cost based on token usage, similar to how providers do it
      const costCalculation = calculateCost(
        result.model,
        result.tokens?.prompt || 0,
        result.tokens?.completion || 0,
        false // Evaluator blocks don't typically use cached input
      )

      // Create result with metrics as direct fields for easy access
      const outputResult = {
        content: inputs.content,
        model: result.model,
        tokens: {
          prompt: result.tokens?.prompt || 0,
          completion: result.tokens?.completion || 0,
          total: result.tokens?.total || 0,
        },
        cost: {
          input: costCalculation.input,
          output: costCalculation.output,
          total: costCalculation.total,
        },
        ...metricScores,
      }

      return outputResult
    } catch (error) {
      logger.error('Evaluator execution failed:', error)
      throw error
    }
  }
}
