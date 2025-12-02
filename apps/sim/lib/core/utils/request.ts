/**
 * Generate a short request ID for correlation
 */
export function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8)
}

/**
 * No-operation function for use as default callback
 */
export const noop = () => {}
