/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { shouldShowAssistantMessageActions } from './message-actions-visibility'

describe('shouldShowAssistantMessageActions', () => {
  it('restores actions when the trailing question card is dismissed', () => {
    expect(
      shouldShowAssistantMessageActions({
        phase: 'settled',
        hasContent: true,
        endsWithInteraction: true,
        questionDismissed: true,
      })
    ).toBe(true)
  })

  it('keeps actions hidden for an active or answered trailing question card', () => {
    expect(
      shouldShowAssistantMessageActions({
        phase: 'settled',
        hasContent: true,
        endsWithInteraction: true,
        questionDismissed: false,
      })
    ).toBe(false)
  })

  it('waits for the message to settle before restoring actions', () => {
    expect(
      shouldShowAssistantMessageActions({
        phase: 'streaming',
        hasContent: true,
        endsWithInteraction: true,
        questionDismissed: true,
      })
    ).toBe(false)
  })
})
