import { createLogger } from '@sim/logger'
import { projectResolvedModelInput } from '@/lib/execution/model-input-provenance'
import {
  type AutoRoutingResult,
  addAutoRoutingCost,
  resolveAutoModel,
  SIM_AUTO_SYSTEM_PREAMBLE,
} from '@/lib/model-router/resolve'
import type { BlockOutput } from '@/blocks/types'
import { validateModelProvider } from '@/ee/access-control/utils/permission-check'
import { BlockType, DEFAULTS, EVALUATOR } from '@/executor/constants'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import { isJSONString, parseJSON, stringifyJSON } from '@/executor/utils/json'
import { executeBlockProviderRequest } from '@/executor/utils/provider-request'
import { projectResolvedSecretDiagnosticError } from '@/executor/utils/resolved-secret-content-projection'
import { refuseResolvedSecretProjection } from '@/executor/utils/resolved-secret-projection-refusal'
import type {
  ResolvedSecretInputPath,
  ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'
import { resolveVertexCredential } from '@/executor/utils/vertex-credential'
import { resolveProxiedModelCost } from '@/providers/cost-policy'
import { isAutoModel, SIM_AUTO_MODEL_ID } from '@/providers/models'
import type { ProviderRequest } from '@/providers/types'
import { getProviderFromModel } from '@/providers/utils'
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
      vertexProject: inputs.vertexProject,
      vertexLocation: inputs.vertexLocation,
      vertexCredential: inputs.vertexCredential,
      bedrockAccessKeyId: inputs.bedrockAccessKeyId,
      bedrockSecretKey: inputs.bedrockSecretKey,
      bedrockRegion: inputs.bedrockRegion,
    }

    let systemPromptObj: { systemPrompt: string; responseFormat: any } = {
      systemPrompt: '',
      responseFormat: null,
    }

    let metrics: any[]
    if (Array.isArray(inputs.metrics)) {
      metrics = inputs.metrics
    } else {
      metrics = []
    }
    const modelInputPaths: ResolvedSecretInputPath[] = [
      ['content'],
      ...metrics.flatMap((_, index) => [
        ['metrics', String(index), 'name'],
        ['metrics', String(index), 'description'],
        ['metrics', String(index), 'range', 'min'],
        ['metrics', String(index), 'range', 'max'],
      ]),
    ]
    const modelInputProjection = projectResolvedModelInput(
      ctx.resolvedSecretTraceRegistry,
      { content: inputs.content, metrics: inputs.metrics },
      modelInputPaths
    )
    if (!modelInputProjection.complete) {
      refuseResolvedSecretProjection({
        site: 'evaluator.contentMetricsModelInput',
        message: 'Evaluator model input could not be safely projected',
        registry: ctx.resolvedSecretTraceRegistry,
        inputPath: 'content,metrics',
      })
    }
    const processedContent = this.processContent(modelInputProjection.value.content)
    const projectedMetrics = Array.isArray(modelInputProjection.value.metrics)
      ? modelInputProjection.value.metrics
      : []
    const metricDescriptions = metrics
      .map((metric: any, index: number) => ({ metric, projected: projectedMetrics[index] }))
      .filter(({ metric, projected }) =>
        Boolean(metric?.name && metric.range && projected?.name && projected.range)
      )
      .map(
        ({ projected }) =>
          `"${projected.name}" (${projected.range.min}-${projected.range.max}): ${projected.description || ''}`
      )
      .join('\n')

    const responseProperties: Record<string, any> = {}
    metrics.forEach((m: any, metricIndex: number) => {
      const projectedMetric = projectedMetrics[metricIndex]
      if (m?.name && projectedMetric?.name) {
        responseProperties[projectedMetric.name.toLowerCase()] = { type: 'number' }
      } else {
        logger.warn('Skipping invalid metric entry during response format generation', {
          metricIndex,
          metricType: m === null ? 'null' : typeof m,
        })
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
          required: metrics.flatMap((m: any, metricIndex: number) => {
            const projectedName = projectedMetrics[metricIndex]?.name
            return m?.name && projectedName ? [projectedName.toLowerCase()] : []
          }),
          additionalProperties: false,
        },
        strict: true,
      },
    }

    if (!systemPromptObj.systemPrompt) {
      systemPromptObj.systemPrompt =
        'Evaluate the content and provide scores for each metric as JSON.'
    }

    let model = evaluatorConfig.model
    let autoRouting: AutoRoutingResult | null = null
    if (isAutoModel(model)) {
      autoRouting = await resolveAutoModel({
        ctx,
        blockId: block.id,
        signals: {
          systemPrompt: systemPromptObj.systemPrompt,
          lastMessage: processedContent,
          messageCount: 1,
          toolNames: [],
          mediaKind: 'none',
          hasResponseFormat: true,
          approxInputTokens: Math.ceil(
            (systemPromptObj.systemPrompt.length + processedContent.length) / 4
          ),
        },
        fallbackModel: EVALUATOR.DEFAULT_MODEL,
      })
      model = autoRouting.model
      systemPromptObj.systemPrompt = [SIM_AUTO_SYSTEM_PREAMBLE, systemPromptObj.systemPrompt]
        .filter(Boolean)
        .join('\n\n')
      logger.info('Resolved sim-auto model for evaluator', {
        blockId: block.id,
        model,
        tier: autoRouting.tier,
        decidedBy: autoRouting.decidedBy,
      })
    }

    await validateModelProvider(ctx.userId, ctx.workspaceId, model, ctx)
    const providerId = getProviderFromModel(model)

    let finalApiKey: string | undefined = evaluatorConfig.apiKey
    if (providerId === 'vertex' && evaluatorConfig.vertexCredential) {
      finalApiKey = await resolveVertexCredential({
        credentialId: evaluatorConfig.vertexCredential,
        actingUserId: ctx.userId,
        workspaceId: ctx.workspaceId,
        workflowId: ctx.workflowId,
        callerLabel: 'vertex-evaluator',
      })
    }

    try {
      const providerRequest: ProviderRequest = {
        model,
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
        apiKey: finalApiKey,
        azureEndpoint: inputs.azureEndpoint,
        azureApiVersion: inputs.azureApiVersion,
        vertexProject: evaluatorConfig.vertexProject,
        vertexLocation: evaluatorConfig.vertexLocation,
        bedrockAccessKeyId: evaluatorConfig.bedrockAccessKeyId,
        bedrockSecretKey: evaluatorConfig.bedrockSecretKey,
        bedrockRegion: evaluatorConfig.bedrockRegion,
        workflowId: ctx.workflowId,
        workspaceId: ctx.workspaceId,
      }

      const result = await executeBlockProviderRequest({
        ctx,
        providerId,
        request: providerRequest,
        resolvedSecretTraceRegistry: modelInputProjection.registry,
      })

      const parsedContent = this.extractJSONFromResponse(
        result.content,
        ctx.resolvedSecretTraceRegistry
      )

      const metricScores = this.extractMetricScores(parsedContent, metrics, projectedMetrics)

      const inputTokens = result.tokens?.input || DEFAULTS.TOKENS.PROMPT
      const outputTokens = result.tokens?.output || DEFAULTS.TOKENS.COMPLETION

      const cost = addAutoRoutingCost(
        resolveProxiedModelCost(result.cost),
        autoRouting?.billableRoutingCost ?? 0
      )

      return {
        content: inputs.content,
        model: autoRouting ? SIM_AUTO_MODEL_ID : result.model,
        tokens: {
          input: inputTokens,
          output: outputTokens,
          total: result.tokens?.total || DEFAULTS.TOKENS.TOTAL,
        },
        cost: {
          input: cost.input,
          output: cost.output,
          total: cost.total,
          ...(cost.routing === undefined ? {} : { routing: cost.routing }),
        },
        ...metricScores,
      }
    } catch (error) {
      logger.error(
        'Evaluator execution failed',
        projectResolvedSecretDiagnosticError(error, ctx.resolvedSecretTraceRegistry)
      )
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

  private extractJSONFromResponse(
    responseContent: string,
    registry: ResolvedSecretTraceRegistry | undefined
  ): Record<string, any> {
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
      logger.error(
        'Error parsing evaluator response',
        projectResolvedSecretDiagnosticError(error, registry, {
          responseContentType: typeof responseContent,
          responseContentLength:
            typeof responseContent === 'string' ? responseContent.length : undefined,
        })
      )
      return {}
    }
  }

  private extractMetricScores(
    parsedContent: Record<string, any>,
    metrics: any,
    projectedMetrics: any
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
          metricScores[metric.name.toLowerCase()] = 0
        }
      })
      return metricScores
    }

    const validProjectedMetrics = Array.isArray(projectedMetrics) ? projectedMetrics : []
    validMetrics.forEach((metric: any, metricIndex: number) => {
      if (!metric?.name) {
        logger.warn('Skipping invalid metric entry', {
          metricIndex,
          metricType: metric === null ? 'null' : typeof metric,
        })
        return
      }

      const projectedName = validProjectedMetrics[metricIndex]?.name
      const score = this.findMetricScore(
        parsedContent,
        typeof projectedName === 'string' && projectedName ? projectedName : metric.name
      )
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

    logger.warn('Metric not found in evaluator response', {
      metricNameLength: metricName.length,
    })
    return 0
  }
}
