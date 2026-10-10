import { isUtf8 } from 'node:buffer'
import { OrchestrationError } from '@/lib/core/orchestration/types'

/** A release body is prose with a few embeds; anything larger is not a release note. */
const MAX_CHANGELOG_BODY_BYTES = 256 * 1024

export function assertChangelogBody(content: Buffer): void {
  if (content.length > MAX_CHANGELOG_BODY_BYTES) {
    throw new OrchestrationError(
      'payload_too_large',
      `A release body can be at most ${MAX_CHANGELOG_BODY_BYTES / 1024}KB`
    )
  }
  if (!isUtf8(content)) {
    throw new OrchestrationError('validation', 'A release body must be UTF-8 markdown')
  }
}
