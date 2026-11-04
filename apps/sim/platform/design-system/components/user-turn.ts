import { generateId } from '@sim/utils/id'
import type { ChatTurn, ComposerDraft } from '@/platform/design-system/models/conversation'

export function userTurn(prompt: ComposerDraft): ChatTurn {
  return {
    id: generateId(),
    prompt,
    time: new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
      new Date()
    ),
  }
}
