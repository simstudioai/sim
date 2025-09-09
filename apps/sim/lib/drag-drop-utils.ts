/**
 * Drag and drop utility functions for handling MIME type variations
 * Addresses issues with Cloudflare Tunnel normalizing MIME types
 */

import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('DragDropUtils')

/**
 * MIME types to try when extracting drag data, in order of preference
 */
const DRAG_DATA_MIME_TYPES = [
  'application/sim-block',      // Custom MIME type for blocks
  'application/json',           // Standard JSON MIME type
  'text/plain',                 // Fallback for text data
  'text/json',                  // Alternative JSON MIME type
] as const

/**
 * Supported block types for validation
 */
export const SUPPORTED_BLOCK_TYPES = [
  'agent',
  'knowledge', 
  'loop',
  'parallel',
  'connectionBlock',
  // Add other supported block types as needed
] as const

export type SupportedBlockType = typeof SUPPORTED_BLOCK_TYPES[number]

/**
 * Structure of drag data for blocks
 */
export interface BlockDragData {
  type: SupportedBlockType
  // Allow additional properties but with more specific typing
  metadata?: Record<string, string | number | boolean>
  config?: Record<string, unknown>
}

/**
 * Result of drag data extraction
 */
export interface DragDataResult {
  success: boolean
  data?: BlockDragData
  error?: string
  mimeTypeUsed?: string
}

/**
 * Check if drag event contains valid block data using multiple MIME type fallbacks
 * This addresses issues where Cloudflare Tunnel normalizes MIME types
 */
export function hasValidBlockDragData(event: React.DragEvent): boolean {
  const types = Array.from(event.dataTransfer?.types || [])
  
  logger.debug('Drag event MIME types detected:', { types })
  
  // Check if any of our supported MIME types are present
  const hasValidMimeType = DRAG_DATA_MIME_TYPES.some(mimeType => types.includes(mimeType))
  
  if (!hasValidMimeType) {
    logger.debug('No valid MIME types found for block drag data')
    return false
  }
  
  // Try to extract and validate data
  const result = extractBlockDragData(event)
  return result.success
}

/**
 * Extract block drag data using multiple MIME type fallbacks
 * Handles cases where Cloudflare Tunnel or other proxies normalize MIME types
 */
export function extractBlockDragData(event: React.DragEvent): DragDataResult {
  if (!event.dataTransfer) {
    return {
      success: false,
      error: 'No dataTransfer available'
    }
  }
  
  const availableTypes = Array.from(event.dataTransfer.types)
  logger.debug('Attempting to extract block data from types:', { availableTypes })
  
  // Try each MIME type in order of preference
  for (const mimeType of DRAG_DATA_MIME_TYPES) {
    if (availableTypes.includes(mimeType)) {
      try {
        const rawData = event.dataTransfer.getData(mimeType)
        logger.debug(`Extracted raw data using ${mimeType}:`, { rawData })
        
        if (!rawData) {
          logger.debug(`No data available for MIME type: ${mimeType}`)
          continue
        }
        
        // Try to parse as JSON with better type safety
        let parsedData: unknown
        try {
          parsedData = JSON.parse(rawData)
        } catch (parseError) {
          // If JSON parsing fails, try to use as-is if it's a simple string
          if (typeof rawData === 'string' && rawData.trim()) {
            // Attempt to create a simple block data structure
            parsedData = { type: rawData.trim() } as BlockDragData
          } else {
            logger.debug(`Failed to parse data for ${mimeType}:`, { parseError })
            continue
          }
        }
        
        // Validate the parsed data structure
        if (isValidBlockDragData(parsedData)) {
          logger.debug(`Successfully extracted block data using ${mimeType}:`, { parsedData })
          return {
            success: true,
            data: parsedData,
            mimeTypeUsed: mimeType
          }
        } else {
          logger.debug(`Invalid block data structure for ${mimeType}:`, { parsedData })
        }
        
      } catch (error) {
        logger.debug(`Error extracting data for ${mimeType}:`, { error })
        continue
      }
    }
  }
  
  return {
    success: false,
    error: 'No valid block data found in any supported MIME type',
    mimeTypeUsed: undefined
  }
}

/**
 * Validate that the extracted data has the correct structure for a block
 */
function isValidBlockDragData(data: any): data is BlockDragData {
  if (!data || typeof data !== 'object') {
    return false
  }
  
  if (!data.type || typeof data.type !== 'string') {
    return false
  }
  
  // Check if it's a supported block type (or allow any string for flexibility)
  // This can be made stricter if needed
  return data.type.trim().length > 0
}

/**
 * Set drag data with multiple MIME type fallbacks for better compatibility
 */
export function setBlockDragData(dataTransfer: DataTransfer, blockData: BlockDragData): void {
  const jsonData = JSON.stringify(blockData)
  
  // Set data for multiple MIME types to ensure compatibility
  try {
    dataTransfer.setData('application/sim-block', jsonData)
    dataTransfer.setData('application/json', jsonData)
    dataTransfer.setData('text/json', jsonData)
    dataTransfer.setData('text/plain', jsonData)
    
    logger.debug('Block drag data set with multiple MIME types:', { blockData })
  } catch (error) {
    logger.error('Failed to set block drag data:', { error })
  }
  
  dataTransfer.effectAllowed = 'move'
}

/**
 * Enhanced logging for debugging drag and drop issues
 * Only logs in development or when debug flag is enabled
 */
export function logDragEvent(eventType: string, event: React.DragEvent): void {
  // Skip logging in production unless debug flag is set
  if (process.env.NODE_ENV === 'production' && !process.env.DRAG_DEBUG) {
    return
  }
  
  if (!event.dataTransfer) return
  
  const types = Array.from(event.dataTransfer.types)
  const debugInfo = {
    eventType,
    availableTypes: types,
    effectAllowed: event.dataTransfer.effectAllowed,
    dropEffect: event.dataTransfer.dropEffect,
  }
  
  // Try to extract data for debugging (non-destructive, limited)
  const dataPreview: Record<string, string> = {}
  for (const type of types.slice(0, 2)) { // Reduced to 2 types for performance
    try {
      const data = event.dataTransfer.getData(type)
      dataPreview[type] = data ? data.substring(0, 50) + (data.length > 50 ? '...' : '') : '(empty)'
    } catch (error) {
      dataPreview[type] = `(error)`
    }
  }
  
  logger.debug('Drag event debug info:', { ...debugInfo, dataPreview })
}