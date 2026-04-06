import { generateId } from '@/lib/core/utils/uuid'
/**
 * Generate a short request ID for correlation
 */
export function generateRequestId(): string {
  return generateId().slice(0, 8)
}

/**
 * No-operation function for use as default callback
 */
export const noop = () => {}
