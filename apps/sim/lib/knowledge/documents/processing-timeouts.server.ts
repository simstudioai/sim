import { env, envNumber } from '@/lib/core/config/env'
import { resolveStaleProcessingMinutes } from '@/lib/knowledge/documents/types'

/**
 * Config-aware horizon shared by every server path that decides whether an
 * active document-processing run is abandoned.
 */
export const DOCUMENT_PROCESSING_STALE_THRESHOLD_MS =
  resolveStaleProcessingMinutes(
    envNumber(env.KB_CONFIG_MAX_DURATION, 600),
    envNumber(env.KB_CONFIG_MAX_ATTEMPTS, 3)
  ) *
  60 *
  1000
