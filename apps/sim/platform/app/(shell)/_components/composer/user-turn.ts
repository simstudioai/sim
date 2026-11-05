import { generateId } from '@sim/utils/id'
import type { ChatTurn, ComposerDraft } from '@/platform/app/(shell)/_components/composer/model'

/** The name a chat goes by until the server titles it. */
export function draftTitle(draft: ComposerDraft): string {
  return draft.text.slice(0, 70) || draft.attachments[0]?.name || 'New chat'
}

export function userTurn(prompt: ComposerDraft): ChatTurn {
  return {
    id: generateId(),
    prompt,
    sentAt: Date.now(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
}
