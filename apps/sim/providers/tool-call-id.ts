/**
 * Stable execution-local tool call ids when a provider omits them (e.g. Gemini).
 * Ensures `${blockId}:${toolCallId}` cannot collide within a run.
 */

import { randomFloat } from '@sim/utils/random'

let localToolIdCounter = 0

/** Reset counter — tests only. */
export function resetLocalToolIdCounterForTests(): void {
  localToolIdCounter = 0
}

export function allocateExecutionLocalToolId(prefix = 'local'): string {
  localToolIdCounter += 1
  const rand = randomFloat().toString(36).slice(2, 8)
  return `${prefix}_${localToolIdCounter}_${rand}`
}

/** Returns provider id if non-empty, otherwise allocates a local one. */
export function ensureToolCallId(providerId: string | null | undefined, prefix = 'local'): string {
  if (typeof providerId === 'string' && providerId.trim().length > 0) {
    return providerId
  }
  return allocateExecutionLocalToolId(prefix)
}
