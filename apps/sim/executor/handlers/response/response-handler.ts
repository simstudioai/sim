import { createLogger } from '@/lib/logs/console/logger'
import type { BlockOutput } from '@/blocks/types'
import { BlockType, HTTP } from '@/executor/consts'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('ResponseBlockHandler')

interface JSONProperty {
  id: string
  name: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'files'
  value: any
  collapsed?: boolean
}

export class ResponseBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.RESPONSE
  }

  async execute(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>
  ): Promise<BlockOutput> {
    logger.info(`Executing response block: ${block.id}`)

    try {
      const responseData = this.parseResponseData(inputs)
      const statusCode = this.parseStatus(inputs.status)
      const responseHeaders = this.parseHeaders(inputs.headers)

      logger.info('Response prepared', {
        status: statusCode,
        dataKeys: Object.keys(responseData),
        headerKeys: Object.keys(responseHeaders),
      })

      return {
        response: {
          data: responseData,
          status: statusCode,
          headers: responseHeaders,
        },
      }
    } catch (error: any) {
      logger.error('Response block execution failed:', error)
      return {
        response: {
          data: {
            error: 'Response block execution failed',
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
      if (Array.isArray(parsed)) {
        return parsed
      }
      return value
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
      return item.value.map((subItem: any) => {
        if (typeof subItem === 'object' && subItem.type) {
          return subItem.value
        }
        return subItem
      })
    }

    return item.value
  }

  private convertNumberValue(value: any): any {
    if (this.isVariableReference(value)) {
      return value
    }

    const numValue = Number(value)
    if (Number.isNaN(numValue)) {
      return value
    }
    return numValue
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
}
