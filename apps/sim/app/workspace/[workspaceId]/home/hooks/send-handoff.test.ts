/** @vitest-environment jsdom */
import { beforeEach, expect, it } from 'vitest'
import { STREAM_STORAGE_KEY } from '@/lib/mothership/constants'
import { readQueuedSendHandoffState, writeQueuedSendHandoffState } from './send-handoff'

beforeEach(() => sessionStorage.clear())
const seed = () => ({
  id: 'handoff',
  chatId: 'chat',
  organizationId: 'org',
  supersededStreamId: 'old',
  userMessageId: 'new',
  message: 'Search',
  requestedAt: Date.now(),
})
it.each([
  [true, 'fast'],
  [false, 'adaptive'],
] as const)('reads legacy Fast %s as %s', (assistantFast, level) => {
  sessionStorage.setItem(
    `${STREAM_STORAGE_KEY}:queued-send-handoff`,
    JSON.stringify({ ...seed(), assistantFast })
  )
  expect(readQueuedSendHandoffState()).toMatchObject({ assistantSearchLevel: level })
  expect(readQueuedSendHandoffState()).not.toHaveProperty('assistantFast')
})
it('rejects invalid levels and preserves an explicit Build mode', () => {
  sessionStorage.setItem(
    `${STREAM_STORAGE_KEY}:queued-send-handoff`,
    JSON.stringify({ ...seed(), assistantSearchLevel: 'unknown' })
  )
  expect(readQueuedSendHandoffState()).toBeNull()
  writeQueuedSendHandoffState({ ...seed(), requestMode: 'agent' })
  expect(readQueuedSendHandoffState()).toMatchObject({ requestMode: 'agent' })
})
