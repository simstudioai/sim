/**
 * @vitest-environment jsdom
 */
import { expect, it, vi } from 'vitest'
import {
  MOTHERSHIP_ADD_CONTEXT_EVENT,
  type MothershipAddContextDetail,
} from '@/lib/mothership/events'
import { handleMothershipAddContextEvent } from '@/app/workspace/[workspaceId]/home/components/user-input/mothership-context-event'

function mockEditor() {
  return {
    insertContext: vi.fn(),
    insertContextChips: vi.fn(),
    focusAtEnd: vi.fn(),
    textareaRef: { current: { focus: vi.fn() } as unknown as HTMLTextAreaElement },
  }
}

it('does not let a second composer claim an event already handled elsewhere', () => {
  const event = new CustomEvent<MothershipAddContextDetail>(MOTHERSHIP_ADD_CONTEXT_EVENT, {
    detail: {
      context: {
        kind: 'browser_tab',
        tabId: 'tab-1',
        label: 'Browser',
        selection: { text: 'selected text' },
      },
    },
    cancelable: true,
  })
  event.preventDefault()
  const editor = mockEditor()

  expect(handleMothershipAddContextEvent(event, editor)).toBe(false)
  expect(editor.insertContext).not.toHaveBeenCalled()
  expect(editor.insertContextChips).not.toHaveBeenCalled()
})
