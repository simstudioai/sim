import type { ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

export interface BlockExecutionErrorDetails {
  block: SerializedBlock
  error: Error | string
  context?: ExecutionContext
  additionalInfo?: Record<string, any>
}

export function buildBlockExecutionError(details: BlockExecutionErrorDetails): Error {
  const errorMessage =
    details.error instanceof Error ? details.error.message : String(details.error)
  const blockName = details.block.metadata?.name || details.block.id
  const blockType = details.block.metadata?.id || 'unknown'

  const error = new Error(`[${blockType}] ${blockName}: ${errorMessage}`)

  Object.assign(error, {
    blockId: details.block.id,
    blockName,
    blockType,
    workflowId: details.context?.workflowId,
    timestamp: new Date().toISOString(),
    ...details.additionalInfo,
  })

  return error
}

export function buildHTTPError(config: {
  status: number
  url?: string
  method?: string
  message?: string
}): Error {
  let errorMessage = config.message || `HTTP ${config.method || 'request'} failed`

  if (config.url) {
    errorMessage += ` - ${config.url}`
  }

  if (config.status) {
    errorMessage += ` (Status: ${config.status})`
  }

  const error = new Error(errorMessage)

  Object.assign(error, {
    status: config.status,
    url: config.url,
    method: config.method,
    timestamp: new Date().toISOString(),
  })

  return error
}

export function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}
