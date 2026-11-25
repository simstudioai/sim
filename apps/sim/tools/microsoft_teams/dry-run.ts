import { rewritesTeamsMessage } from '@/lib/internal/microsoft-teams/message-rewrite'
import { dryRunId } from '@/tools/dry-run'
import type { MicrosoftTeamsToolParams } from '@/tools/microsoft_teams/types'

/**
 * A dry run's placeholder for a message a write tool sends: the content as sent, unless files or
 * mentions make Teams rewrite it, and a placeholder message id. Where it was sent the tool's own
 * hook adds from the ids the call names.
 */
export function placeholderTeamsMessage(params: MicrosoftTeamsToolParams) {
  const content = params.content ?? ''
  return {
    messageId: dryRunId('message'),
    updatedContent: true,
    ...(rewritesTeamsMessage(content, params.files) ? {} : { content }),
  }
}
