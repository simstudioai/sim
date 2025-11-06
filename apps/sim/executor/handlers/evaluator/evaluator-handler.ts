import { createLogger } from '@/lib/logs/console/logger'
import type { BlockOutput } from '@/blocks/types'
import { BlockType, DEFAULTS, EVALUATOR, HTTP } from '@/executor/consts'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import { buildAPIUrl, extractAPIErrorMessage } from '@/executor/utils/http'
import { isJSONString, parseJSON, stringifyJSON } from '@/executor/utils/json'
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
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>
  ): Promise<BlockOutput> {
    const evaluatorConfig = {
      model: inputs.model || EVALUATOR.DEFAULT_MODEL,
      apiKey: inputs.apiKey,
    }
    const providerId = getProviderFromModel(evaluatorConfig.model)

    const processedContent = this.processContent(inputs.content)

    let systemPromptObj: { systemPrompt: string; responseFormat: any } = {
      systemPrompt: '',
      responseFormat: null,
    }

    logger.info('Inputs for evaluator:', inputs)
    let metrics: any[]
    if (Array.isArray(inputs.metrics)) {
      metrics = inputs.metrics
    } else {
      metrics = []
    }
    logger.info('Metrics for evaluator:', metrics)
    const metricDescriptions = metrics
      .filter((m: any) => m?.name && m.range)
      .map((m: any) => `"${m.name}" (${m.range.min}-${m.range.max}): ${m.description || ''}`)
      .join('\n')

    const responseProperties: Record<string, any> = {}
    metrics.forEach((m: any) => {
      if (m?.name) {
        responseProperties[m.name.toLowerCase()] = { type: 'number' }
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
        name: EVALUATOR.RESPONSE_SCHEMA_NAME,
        schema: {
          type: 'object',
          properties: responseProperties,
          required: metrics.filter((m: any) => m?.name).map((m: any) => m.name.toLowerCase()),
          additionalProperties: false,
        },
        strict: true,
      },
    }

    if (!systemPromptObj.systemPrompt) {
      systemPromptObj.systemPrompt =
        'Evaluate the content and provide scores for each metric as JSON.'
    }

    try {
      const url = buildAPIUrl('/api/providers')

      const providerRequest = {
        provider: providerId,
        model: evaluatorConfig.model,
        systemPrompt: systemPromptObj.systemPrompt,
        responseFormat: systemPromptObj.responseFormat,
        context: stringifyJSON([
          {
            role: 'user',
            content:
              'Please evaluate the content provided in the system prompt. Return ONLY a valid JSON with metric scores.',
          },
        ]),

        temperature: EVALUATOR.DEFAULT_TEMPERATURE,
        apiKey: evaluatorConfig.apiKey,
        workflowId: ctx.workflowId,
      }

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': HTTP.CONTENT_TYPE.JSON,
        },
        body: stringifyJSON(providerRequest),
      })

      if (!response.ok) {
        const errorMessage = await extractAPIErrorMessage(response)
        throw new Error(errorMessage)
      }

      const result = await response.json()

      const parsedContent = this.extractJSONFromResponse(result.content)

      const metricScores = this.extractMetricScores(parsedContent, inputs.metrics)

      const costCalculation = calculateCost(
        result.model,
        result.tokens?.prompt || DEFAULTS.TOKENS.PROMPT,
        result.tokens?.completion || DEFAULTS.TOKENS.COMPLETION,
        false
      )

      return {
        content: inputs.content,
        model: result.model,
        tokens: {
          prompt: result.tokens?.prompt || DEFAULTS.TOKENS.PROMPT,
          completion: result.tokens?.completion || DEFAULTS.TOKENS.COMPLETION,
          total: result.tokens?.total || DEFAULTS.TOKENS.TOTAL,
        },
        cost: {
          input: costCalculation.input,
          output: costCalculation.output,
          total: costCalculation.total,
        },
        ...metricScores,
      }
    } catch (error) {
      logger.error('Evaluator execution failed:', error)
      throw error
    }
  }

  private processContent(content: any): string {
    if (typeof content === 'string') {
      if (isJSONString(content)) {
        const parsed = parseJSON(content, null)
        if (parsed) {
          return stringifyJSON(parsed)
        }
        return content
      }
      return content
    }

    if (typeof content === 'object') {
      return stringifyJSON(content)
    }

    return String(content || '')
  }

  private extractJSONFromResponse(responseContent: string): Record<string, any> {
    try {
      const contentStr = responseContent.trim()

      const fullMatch = contentStr.match(/(\{[\s\S]*\})/)
      if (fullMatch) {
        return parseJSON(fullMatch[0], {})
      }

      if (contentStr.includes('{') && contentStr.includes('}')) {
        const startIdx = contentStr.indexOf('{')
        const endIdx = contentStr.lastIndexOf('}') + 1
        const jsonStr = contentStr.substring(startIdx, endIdx)
        return parseJSON(jsonStr, {})
      }

      return parseJSON(contentStr, {})
    } catch (error) {
      logger.error('Error parsing evaluator response:', error)
      logger.error('Raw response content:', responseContent)
      return {}
    }
  }

  private extractMetricScores(
    parsedContent: Record<string, any>,
    metrics: any
  ): Record<string, number> {
    const metricScores: Record<string, number> = {}
    let validMetrics: any[]
    if (Array.isArray(metrics)) {
      validMetrics = metrics
    } else {
      validMetrics = []
    }

    if (Object.keys(parsedContent).length === 0) {
      validMetrics.forEach((metric: any) => {
        if (metric?.name) {
          metricScores[metric.name.toLowerCase()] = DEFAULTS.EXECUTION_TIME
        }
      })
      return metricScores
    }

    validMetrics.forEach((metric: any) => {
      if (!metric?.name) {
        logger.warn('Skipping invalid metric entry:', metric)
        return
      }

      const score = this.findMetricScore(parsedContent, metric.name)
      metricScores[metric.name.toLowerCase()] = score
    })

    return metricScores
  }

  private findMetricScore(parsedContent: Record<string, any>, metricName: string): number {
    const lowerMetricName = metricName.toLowerCase()

    if (parsedContent[metricName] !== undefined) {
      return Number(parsedContent[metricName])
    }

    if (parsedContent[lowerMetricName] !== undefined) {
      return Number(parsedContent[lowerMetricName])
    }

    const matchingKey = Object.keys(parsedContent).find((key) => {
      return typeof key === 'string' && key.toLowerCase() === lowerMetricName
    })

    if (matchingKey) {
      return Number(parsedContent[matchingKey])
    }

    logger.warn(`Metric "${metricName}" not found in LLM response`)
    return DEFAULTS.EXECUTION_TIME
  }
}
