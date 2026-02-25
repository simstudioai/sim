import { createLogger } from '@sim/logger'
import { BlockType, HTTP } from '@/executor/constants'
import type { BlockHandler, ExecutionContext, NormalizedBlockOutput } from '@/executor/types'
import {
  convertBuilderDataToJson,
  convertBuilderDataToJsonString,
} from '@/executor/utils/builder-data'
import { parseObjectStrings } from '@/executor/utils/json'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('ResponseBlockHandler')

export class ResponseBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.RESPONSE
  }

  async execute(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>
  ): Promise<NormalizedBlockOutput> {
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
        data: responseData,
        status: statusCode,
        headers: responseHeaders,
      }
    } catch (error: any) {
      logger.error('Response block execution failed:', error)
      return {
        data: {
          error: 'Response block execution failed',
          message: error.message || 'Unknown error',
        },
        status: HTTP.STATUS.SERVER_ERROR,
        headers: { 'Content-Type': HTTP.CONTENT_TYPE.JSON },
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
      const convertedData = convertBuilderDataToJson(inputs.builderData)
      return parseObjectStrings(convertedData)
    }

    return inputs.data || {}
  }

  static convertBuilderDataToJsonString(builderData: any[]): string {
    return convertBuilderDataToJsonString(builderData)
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
