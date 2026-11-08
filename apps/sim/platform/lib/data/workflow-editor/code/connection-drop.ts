import { createLogger } from '@sim/logger'

const logger = createLogger('ConnectionDrop')

/** A block's connection dragged from the canvas onto a field. */
interface ConnectionDrop {
  /** The block whose outputs the reference picker narrows to, when the drag names one. */
  sourceBlockId: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Reads a canvas connection drag out of a drop's data transfer. Anything else dropped on the field
 * (text, files, another app's JSON) is not a connection and reads as `null`.
 */
export function readConnectionDrop(dataTransfer: DataTransfer): ConnectionDrop | null {
  const raw = dataTransfer.getData('application/json')
  if (!raw) return null
  try {
    const data: unknown = JSON.parse(raw)
    if (!isRecord(data) || data.type !== 'connectionBlock') return null
    const connection = isRecord(data.connectionData) ? data.connectionData : undefined
    const sourceBlockId =
      typeof connection?.sourceBlockId === 'string' && connection.sourceBlockId
        ? connection.sourceBlockId
        : null
    return { sourceBlockId }
  } catch (error) {
    logger.error('Failed to parse drop data', { error })
    return null
  }
}
