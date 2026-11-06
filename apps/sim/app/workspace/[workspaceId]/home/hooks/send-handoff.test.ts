/** @vitest-environment jsdom */
import { beforeEach, expect, it } from 'vitest'
import { MAX_CHAT_CONTEXTS } from '@/lib/mothership/chat/context-limits'
import { STREAM_STORAGE_KEY } from '@/lib/mothership/constants'
import {
  readQueuedSendHandoffState,
  writeQueuedSendHandoffState,
} from '@/app/workspace/[workspaceId]/home/hooks/send-handoff'

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

it('keeps lost-context evidence when a recovered handoff is written again', () => {
  const validContext = { kind: 'docs' as const, label: 'Docs' }
  writeQueuedSendHandoffState({
    ...seed(),
    contexts: [
      validContext,
      {
        kind: 'browser_tab',
        tabId: 'tab-a',
        label: 'Browser',
        selection: { text: 'Selected passage', title: 'x'.repeat(513) },
      },
    ],
  })
  const recovered = readQueuedSendHandoffState()
  expect(recovered).toMatchObject({ contexts: [validContext], hasUnavailableContexts: true })
  if (!recovered) throw new Error('Expected a recoverable handoff')
  writeQueuedSendHandoffState(recovered)
  expect(readQueuedSendHandoffState()).toMatchObject({
    contexts: [validContext],
    hasUnavailableContexts: true,
  })
})

it.each([null, {}, 'invalid'])(
  'keeps the message for review when stored contexts are malformed (%s)',
  (contexts) => {
    sessionStorage.setItem(
      `${STREAM_STORAGE_KEY}:queued-send-handoff`,
      JSON.stringify({ ...seed(), contexts })
    )
    expect(readQueuedSendHandoffState()).toMatchObject({
      message: 'Search',
      hasUnavailableContexts: true,
    })
  }
)

it.each([100, 101])(
  'recovers %s contexts within the send limit without losing review state',
  (count) => {
    const contexts = Array.from({ length: count }, (_, index) => ({
      kind: 'file' as const,
      fileId: `file-${index}`,
      label: `File ${index}`,
    }))
    writeQueuedSendHandoffState({ ...seed(), contexts })
    const recovered = readQueuedSendHandoffState()
    expect(recovered?.contexts).toEqual(contexts.slice(0, MAX_CHAT_CONTEXTS))
    expect(recovered?.message).toBe('Search')
    expect(recovered?.hasUnavailableContexts).toBe(count > MAX_CHAT_CONTEXTS ? true : undefined)
    if (!recovered) throw new Error('Expected a recoverable handoff')
    writeQueuedSendHandoffState(recovered)
    expect(readQueuedSendHandoffState()).toEqual(recovered)
  }
)

it('keeps a full limit of valid contexts when an earlier stored context is invalid', () => {
  const contexts = Array.from({ length: MAX_CHAT_CONTEXTS }, (_, index) => ({
    kind: 'file' as const,
    fileId: `file-${index}`,
    label: `File ${index}`,
  }))
  sessionStorage.setItem(
    `${STREAM_STORAGE_KEY}:queued-send-handoff`,
    JSON.stringify({
      ...seed(),
      contexts: [{ kind: 'workspace', label: 'Missing address' }, ...contexts],
    })
  )
  expect(readQueuedSendHandoffState()).toMatchObject({ contexts, hasUnavailableContexts: true })
})
