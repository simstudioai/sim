import { createLogger } from '@/lib/logs/console-logger'
import type { BlockOutput } from '@/blocks/types'
import { BlockType } from '@/executor/consts'
import type { BlockHandler } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('ResponseBlockHandler')

interface JSONProperty {
  id: string
  key: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  value: any
  collapsed?: boolean
}

export class ResponseBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.RESPONSE
  }

  async execute(block: SerializedBlock, inputs: Record<string, any>): Promise<BlockOutput> {
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
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        },
      }
    }
  }

  private parseResponseData(inputs: Record<string, any>): any {
    const dataMode = inputs.dataMode || 'structured'

    if (dataMode === 'json' && inputs.data) {
      // Handle JSON mode - data comes from code editor
      if (typeof inputs.data === 'string') {
        try {
          return JSON.parse(inputs.data)
        } catch (error) {
          logger.warn('Failed to parse JSON data, returning as string:', error)
          return inputs.data
        }
      } else if (typeof inputs.data === 'object' && inputs.data !== null) {
        // Data is already an object, return as-is
        return inputs.data
      }
      return inputs.data
    }

    if (dataMode === 'structured' && inputs.builderData) {
      // Handle structured mode - convert builderData to JSON
      const convertedData = this.convertBuilderDataToJson(inputs.builderData)
      return this.parseObjectStrings(convertedData)
    }

    // Fallback to inputs.data for backward compatibility
    return inputs.data || {}
  }

  private convertBuilderDataToJson(builderData: JSONProperty[]): any {
    if (!Array.isArray(builderData)) {
      return {}
    }

    const result: any = {}

    for (const prop of builderData) {
      if (!prop.key.trim()) {
        return
      }

      const value = this.convertPropertyValue(prop)
      result[prop.key] = value
    }

    return result
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

    // Keep variable references or other values as-is (they'll be resolved later)
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

    // Keep variable references or other values as-is
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
      // Try to parse strings that might be JSON objects
      try {
        const parsed = JSON.parse(data)
        if (typeof parsed === 'object' && parsed !== null) {
          return this.parseObjectStrings(parsed) // Recursively parse nested objects
        }
        return parsed
      } catch {
        return data // Return as string if not valid JSON
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
    if (!status) return 200
    const parsed = Number(status)
    if (Number.isNaN(parsed) || parsed < 100 || parsed > 599) {
      return 200
    }
    return parsed
  }

  private parseHeaders(
    headers: {
      id: string
      cells: { Key: string; Value: string }
    }[]
  ): Record<string, string> {
    const defaultHeaders = { 'Content-Type': 'application/json' }
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
