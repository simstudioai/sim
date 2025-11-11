import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'
import type { BlockOutput } from '@/blocks/types'
import {
  BlockType,
  buildResumeApiUrl,
  buildResumeUiUrl,
  type FieldType,
  HTTP,
  PAUSE_RESUME,
} from '@/executor/consts'
import {
  generatePauseContextId,
  mapNodeMetadataToPauseScopes,
} from '@/executor/human-in-the-loop/utils'
import type { BlockHandler, ExecutionContext, PauseMetadata } from '@/executor/types'
import { collectBlockData } from '@/executor/utils/block-data'
import type { SerializedBlock } from '@/serializer/types'
import { normalizeBlockName } from '@/stores/workflows/utils'
import { executeTool } from '@/tools'

const logger = createLogger('HumanInTheLoopBlockHandler')

interface JSONProperty {
  id: string
  name: string
  type: FieldType
  value: any
  collapsed?: boolean
}

interface ResponseStructureEntry {
  name: string
  type: string
  value: any
}

interface NormalizedInputField {
  id: string
  name: string
  label: string
  type: string
  description?: string
  placeholder?: string
  value?: any
  required?: boolean
  options?: any[]
}

interface NotificationToolResult {
  toolId: string
  title?: string
  operation?: string
  success: boolean
  durationMs?: number
}

export class HumanInTheLoopBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.HUMAN_IN_THE_LOOP
  }

  async execute(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>
  ): Promise<BlockOutput> {
    return this.executeWithNode(ctx, block, inputs, {
      nodeId: block.id,
    })
  }

  async executeWithNode(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>,
    nodeMetadata: {
      nodeId: string
      loopId?: string
      parallelId?: string
      branchIndex?: number
      branchTotal?: number
    }
  ): Promise<BlockOutput> {
    try {
      const operation = inputs.operation ?? PAUSE_RESUME.OPERATION.HUMAN

      const { parallelScope, loopScope } = mapNodeMetadataToPauseScopes(ctx, nodeMetadata)
      const contextId = generatePauseContextId(block.id, nodeMetadata, loopScope)
      const timestamp = new Date().toISOString()

      const executionId = ctx.executionId ?? ctx.metadata?.executionId
      const workflowId = ctx.workflowId

      let resumeLinks: typeof pauseMetadata.resumeLinks | undefined
      if (executionId && workflowId) {
        try {
          const baseUrl = getBaseUrl()
          resumeLinks = {
            apiUrl: buildResumeApiUrl(baseUrl, workflowId, executionId, contextId),
            uiUrl: buildResumeUiUrl(baseUrl, workflowId, executionId),
            contextId,
            executionId,
            workflowId,
          }
        } catch (error) {
          logger.warn('Failed to get base URL, using relative paths', { error })
          resumeLinks = {
            apiUrl: buildResumeApiUrl(undefined, workflowId, executionId, contextId),
            uiUrl: buildResumeUiUrl(undefined, workflowId, executionId),
            contextId,
            executionId,
            workflowId,
          }
        }
      }

      const normalizedInputFormat = this.normalizeInputFormat(inputs.inputFormat)
      const responseStructure = this.normalizeResponseStructure(inputs.builderData)

      let responseData: any
      let statusCode: number
      let responseHeaders: Record<string, string>

      if (operation === PAUSE_RESUME.OPERATION.API) {
        const parsed = this.parseResponseData(inputs)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          responseData = {
            ...parsed,
            operation,
            responseStructure:
              parsed.responseStructure && Array.isArray(parsed.responseStructure)
                ? parsed.responseStructure
                : responseStructure,
          }
        } else {
          responseData = parsed
        }
        statusCode = this.parseStatus(inputs.status)
        responseHeaders = this.parseHeaders(inputs.headers)
      } else {
        responseData = {
          operation,
          responseStructure,
          inputFormat: normalizedInputFormat,
          submission: null,
        }
        statusCode = HTTP.STATUS.OK
        responseHeaders = { 'Content-Type': HTTP.CONTENT_TYPE.JSON }
      }

      let notificationResults: NotificationToolResult[] | undefined

      if (
        operation === PAUSE_RESUME.OPERATION.HUMAN &&
        inputs.notification &&
        Array.isArray(inputs.notification)
      ) {
        notificationResults = await this.executeNotificationTools(ctx, block, inputs.notification, {
          resumeLinks,
          executionId,
          workflowId,
          inputFormat: normalizedInputFormat,
          responseStructure,
          operation,
        })
      }

      const responseDataWithResume =
        resumeLinks &&
        responseData &&
        typeof responseData === 'object' &&
        !Array.isArray(responseData)
          ? { ...responseData, _resume: resumeLinks }
          : responseData

      const pauseMetadata: PauseMetadata = {
        contextId,
        blockId: nodeMetadata.nodeId,
        response: {
          data: responseDataWithResume,
          status: statusCode,
          headers: responseHeaders,
        },
        timestamp,
        parallelScope,
        loopScope,
        resumeLinks,
      }

      const responseOutput: Record<string, any> = {
        data: responseDataWithResume,
        status: statusCode,
        headers: responseHeaders,
        operation,
      }

      if (operation === PAUSE_RESUME.OPERATION.HUMAN) {
        responseOutput.responseStructure = responseStructure
        responseOutput.inputFormat = normalizedInputFormat
        responseOutput.submission = null
      }

      if (resumeLinks) {
        responseOutput.resume = resumeLinks
      }

      const structuredFields: Record<string, any> = {}
      if (operation === PAUSE_RESUME.OPERATION.HUMAN) {
        for (const field of normalizedInputFormat) {
          if (field.name) {
            structuredFields[field.name] = field.value !== undefined ? field.value : null
          }
        }
      }

      const output: Record<string, any> = {
        ...structuredFields,
        response: responseOutput,
        _pauseMetadata: pauseMetadata,
      }

      if (notificationResults && notificationResults.length > 0) {
        output.notificationResults = notificationResults
      }

      if (resumeLinks) {
        output.url = resumeLinks.uiUrl
        // output.apiUrl = resumeLinks.apiUrl // Hidden from output
      }

      return output
    } catch (error: any) {
      logger.error('Pause resume block execution failed:', error)
      return {
        response: {
          data: {
            error: 'Pause resume block execution failed',
            message: error.message || 'Unknown error',
          },
          status: HTTP.STATUS.SERVER_ERROR,
          headers: { 'Content-Type': HTTP.CONTENT_TYPE.JSON },
        },
      }
    }
  }

  private parseResponseData(inputs: Record<string, any>): any {
    const dataMode = inputs.dataMode || 'structured'

    if (dataMode === 'json' && inputs.data) {
      if (typeof inputs.data === 'string') {
        try {
          return JSON.parse(inputs.data)
        } catch (error) {
          logger.warn('Failed to parse JSON data, returning as string:', error)
          return inputs.data
        }
      } else if (typeof inputs.data === 'object' && inputs.data !== null) {
        return inputs.data
      }
      return inputs.data
    }

    if (dataMode === 'structured' && inputs.builderData) {
      const convertedData = this.convertBuilderDataToJson(inputs.builderData)
      return this.parseObjectStrings(convertedData)
    }

    return inputs.data || {}
  }

  private normalizeResponseStructure(
    builderData?: JSONProperty[],
    prefix = ''
  ): ResponseStructureEntry[] {
    if (!Array.isArray(builderData)) {
      return []
    }

    const entries: ResponseStructureEntry[] = []

    for (const prop of builderData) {
      const fieldName = typeof prop.name === 'string' ? prop.name.trim() : ''
      if (!fieldName) continue

      const path = prefix ? `${prefix}.${fieldName}` : fieldName

      if (prop.type === 'object' && Array.isArray(prop.value)) {
        const nested = this.normalizeResponseStructure(prop.value, path)
        if (nested.length > 0) {
          entries.push(...nested)
          continue
        }
      }

      const value = this.convertPropertyValue(prop)

      entries.push({
        name: path,
        type: prop.type,
        value,
      })
    }

    return entries
  }

  private normalizeInputFormat(inputFormat: any): NormalizedInputField[] {
    if (!Array.isArray(inputFormat)) {
      return []
    }

    return inputFormat
      .map((field: any, index: number) => {
        const name = typeof field?.name === 'string' ? field.name.trim() : ''
        if (!name) return null

        const id =
          typeof field?.id === 'string' && field.id.length > 0 ? field.id : `field_${index}`
        const label =
          typeof field?.label === 'string' && field.label.trim().length > 0
            ? field.label.trim()
            : name
        const type =
          typeof field?.type === 'string' && field.type.trim().length > 0 ? field.type : 'string'
        const description =
          typeof field?.description === 'string' && field.description.trim().length > 0
            ? field.description.trim()
            : undefined
        const placeholder =
          typeof field?.placeholder === 'string' && field.placeholder.trim().length > 0
            ? field.placeholder.trim()
            : undefined
        const required = field?.required === true
        const options = Array.isArray(field?.options) ? field.options : undefined

        return {
          id,
          name,
          label,
          type,
          description,
          placeholder,
          value: field?.value,
          required,
          options,
        } as NormalizedInputField
      })
      .filter((field): field is NormalizedInputField => field !== null)
  }

  private convertBuilderDataToJson(builderData: JSONProperty[]): any {
    if (!Array.isArray(builderData)) {
      return {}
    }

    const result: any = {}

    for (const prop of builderData) {
      if (!prop.name || !prop.name.trim()) {
        continue
      }

      const value = this.convertPropertyValue(prop)
      result[prop.name] = value
    }

    return result
  }

  static convertBuilderDataToJsonString(builderData: JSONProperty[]): string {
    if (!Array.isArray(builderData) || builderData.length === 0) {
      return '{\n  \n}'
    }

    const result: any = {}

    for (const prop of builderData) {
      if (!prop.name || !prop.name.trim()) {
        continue
      }

      result[prop.name] = prop.value
    }

    let jsonString = JSON.stringify(result, null, 2)

    jsonString = jsonString.replace(/"(<[^>]+>)"/g, '$1')

    return jsonString
  }

  private convertPropertyValue(prop: JSONProperty): any {
    switch (prop.type) {
      case 'object':
        return this.convertObjectValue(prop.value)
      case 'array':
        return this.convertArrayValue(prop.value)
      case 'number':
        return this.convertNumberValue(prop.value)
      case 'boolean':
        return this.convertBooleanValue(prop.value)
      case 'files':
        return prop.value
      default:
        return prop.value
    }
  }

  private convertObjectValue(value: any): any {
    if (Array.isArray(value)) {
      return this.convertBuilderDataToJson(value)
    }

    if (typeof value === 'string' && !this.isVariableReference(value)) {
      return this.tryParseJson(value, value)
    }

    return value
  }

  private convertArrayValue(value: any): any {
    if (Array.isArray(value)) {
      return value.map((item: any) => this.convertArrayItem(item))
    }

    if (typeof value === 'string' && !this.isVariableReference(value)) {
      const parsed = this.tryParseJson(value, value)
      return Array.isArray(parsed) ? parsed : value
    }

    return value
  }

  private convertArrayItem(item: any): any {
    if (typeof item !== 'object' || !item.type) {
      return item
    }

    if (item.type === 'object' && Array.isArray(item.value)) {
      return this.convertBuilderDataToJson(item.value)
    }

    if (item.type === 'array' && Array.isArray(item.value)) {
      return item.value.map((subItem: any) =>
        typeof subItem === 'object' && subItem.type ? subItem.value : subItem
      )
    }

    return item.value
  }

  private convertNumberValue(value: any): any {
    if (this.isVariableReference(value)) {
      return value
    }

    const numValue = Number(value)
    return Number.isNaN(numValue) ? value : numValue
  }

  private convertBooleanValue(value: any): any {
    if (this.isVariableReference(value)) {
      return value
    }

    return value === 'true' || value === true
  }

  private tryParseJson(jsonString: string, fallback: any): any {
    try {
      return JSON.parse(jsonString)
    } catch {
      return fallback
    }
  }

  private isVariableReference(value: any): boolean {
    return typeof value === 'string' && value.trim().startsWith('<') && value.trim().includes('>')
  }

  private parseObjectStrings(data: any): any {
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data)
        if (typeof parsed === 'object' && parsed !== null) {
          return this.parseObjectStrings(parsed)
        }
        return parsed
      } catch {
        return data
      }
    } else if (Array.isArray(data)) {
      return data.map((item) => this.parseObjectStrings(item))
    } else if (typeof data === 'object' && data !== null) {
      const result: any = {}
      for (const [key, value] of Object.entries(data)) {
        result[key] = this.parseObjectStrings(value)
      }
      return result
    }
    return data
  }

  private parseStatus(status?: string): number {
    if (!status) return HTTP.STATUS.OK
    const parsed = Number(status)
    if (Number.isNaN(parsed) || parsed < 100 || parsed > 599) {
      return HTTP.STATUS.OK
    }
    return parsed
  }

  private parseHeaders(
    headers: {
      id: string
      cells: { Key: string; Value: string }
    }[]
  ): Record<string, string> {
    const defaultHeaders = { 'Content-Type': HTTP.CONTENT_TYPE.JSON }
    if (!headers) return defaultHeaders

    const headerObj = headers.reduce((acc: Record<string, string>, header) => {
      if (header?.cells?.Key && header?.cells?.Value) {
        acc[header.cells.Key] = header.cells.Value
      }
      return acc
    }, {})

    return { ...defaultHeaders, ...headerObj }
  }

  private async executeNotificationTools(
    ctx: ExecutionContext,
    block: SerializedBlock,
    tools: any[],
    context: {
      resumeLinks?: {
        apiUrl: string
        uiUrl: string
        contextId: string
        executionId: string
        workflowId: string
      }
      executionId?: string
      workflowId?: string
      inputFormat?: NormalizedInputField[]
      responseStructure?: ResponseStructureEntry[]
      operation?: string
    }
  ): Promise<NotificationToolResult[]> {
    if (!tools || tools.length === 0) {
      return []
    }

    const { blockData: collectedBlockData, blockNameMapping: collectedBlockNameMapping } =
      collectBlockData(ctx)

    const blockDataWithPause: Record<string, any> = { ...collectedBlockData }
    const blockNameMappingWithPause: Record<string, string> = { ...collectedBlockNameMapping }

    const pauseBlockId = block.id
    const pauseBlockName = block.metadata?.name

    const pauseOutput: Record<string, any> = {
      ...(blockDataWithPause[pauseBlockId] || {}),
    }

    if (context.resumeLinks) {
      if (context.resumeLinks.uiUrl) {
        pauseOutput.url = context.resumeLinks.uiUrl
      }
      // if (context.resumeLinks.apiUrl) {
      //   pauseOutput.apiUrl = context.resumeLinks.apiUrl
      // } // Hidden from output
    }

    if (Array.isArray(context.inputFormat)) {
      for (const field of context.inputFormat) {
        if (field?.name) {
          const fieldName = field.name.trim()
          if (fieldName.length > 0 && !(fieldName in pauseOutput)) {
            pauseOutput[fieldName] = field.value !== undefined ? field.value : null
          }
        }
      }
    }

    blockDataWithPause[pauseBlockId] = pauseOutput

    if (pauseBlockName) {
      blockNameMappingWithPause[pauseBlockName] = pauseBlockId
      blockNameMappingWithPause[normalizeBlockName(pauseBlockName)] = pauseBlockId
    }

    const notificationPromises = tools.map<Promise<NotificationToolResult>>(async (toolConfig) => {
      const startTime = Date.now()
      try {
        const toolId = toolConfig.toolId
        if (!toolId) {
          logger.warn('Notification tool missing toolId', { toolConfig })
          return {
            toolId: 'unknown',
            title: toolConfig.title,
            operation: toolConfig.operation,
            success: false,
          }
        }

        const toolParams = {
          ...toolConfig.params,
          _pauseContext: {
            resumeApiUrl: context.resumeLinks?.apiUrl,
            resumeUiUrl: context.resumeLinks?.uiUrl,
            executionId: context.executionId,
            workflowId: context.workflowId,
            contextId: context.resumeLinks?.contextId,
            inputFormat: context.inputFormat,
            responseStructure: context.responseStructure,
            operation: context.operation,
          },
          _context: {
            workflowId: ctx.workflowId,
            workspaceId: ctx.workspaceId,
          },
          blockData: blockDataWithPause,
          blockNameMapping: blockNameMappingWithPause,
        }

        const result = await executeTool(toolId, toolParams, false, false, ctx)
        const durationMs = Date.now() - startTime

        if (!result.success) {
          logger.warn('Notification tool execution failed', {
            toolId,
            error: result.error,
          })
          return {
            toolId,
            title: toolConfig.title,
            operation: toolConfig.operation,
            success: false,
            durationMs,
          }
        }

        return {
          toolId,
          title: toolConfig.title,
          operation: toolConfig.operation,
          success: true,
          durationMs,
        }
      } catch (error) {
        logger.error('Error executing notification tool', { error, toolConfig })
        return {
          toolId: toolConfig.toolId || 'unknown',
          title: toolConfig.title,
          operation: toolConfig.operation,
          success: false,
        }
      }
    })

    return Promise.all(notificationPromises)
  }
}
