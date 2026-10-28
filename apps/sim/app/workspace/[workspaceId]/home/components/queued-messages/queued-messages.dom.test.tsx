/**
 * @vitest-environment jsdom
 */
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** The queued message renders its content through the real block registry. */
vi.unmock('@/blocks/registry')

import { QueuedMessages } from '@/app/workspace/[workspaceId]/home/components/queued-messages/queued-messages'

const mounted: Array<() => void> = []

/** jsdom has no ResizeObserver; the queue measures its width with one. */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

interface EditableQueueProps {
  admissionUnknown: boolean
}

/** The queue as the chat composer drives it: Edit opens the entry, Cancel edit closes it. */
function EditableQueue({ admissionUnknown }: EditableQueueProps) {
  const [editingQueuedId, setEditingQueuedId] = useState<string | null>(null)
  return (
    <QueuedMessages
      messageQueue={[{ id: 'held-first', content: 'inspect the workspace', admissionUnknown }]}
      editingQueuedId={editingQueuedId}
      dispatchingHeadId={null}
      onRemove={() => {}}
      onSendNow={async () => {}}
      onEdit={setEditingQueuedId}
      onCancelEdit={() => setEditingQueuedId(null)}
    />
  )
}

function renderQueue(admissionUnknown: boolean) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<EditableQueue admissionUnknown={admissionUnknown} />)
  })
  mounted.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  const editButton = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Edit queued message"], button[aria-label^="May already be sent"]'
  )
  if (!editButton) throw new Error('Edit button not rendered')
  /** An entry open for editing shows its Cancel edit control in place of Edit. */
  const isEditing = () => container.querySelector('button[aria-label="Cancel edit"]') !== null
  return { editButton, isEditing }
}

describe('QueuedMessages edit button', () => {
  afterEach(() => {
    for (const unmount of mounted.splice(0)) unmount()
  })

  it('keeps a message that may already be sent from being edited, and says why', () => {
    const { editButton, isEditing } = renderQueue(true)

    /** Still focusable and hoverable, so its tooltip can explain why. */
    expect(editButton.disabled).toBe(false)
    expect(editButton.getAttribute('aria-disabled')).toBe('true')
    expect(editButton.getAttribute('aria-label')).toBe(
      'May already be sent; editing could send a second message'
    )
    act(() => editButton.click())
    expect(isEditing()).toBe(false)
  })

  it('opens an ordinary queued message for editing', () => {
    const { editButton, isEditing } = renderQueue(false)

    act(() => editButton.click())
    expect(isEditing()).toBe(true)
  })
})
