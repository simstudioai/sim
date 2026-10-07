/**
 * @vitest-environment jsdom
 */
import { act, type ChangeEvent, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useContextManagement } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-context-management'
import type { ChatContext } from '@/stores/panel'

let container: HTMLDivElement
let root: Root
let latest: ReturnType<typeof useContextManagement>

/** Renders the hook with a fixed message and initial contexts, exposing its result. */
function renderSync(message: string, initialContexts: ChatContext[]) {
  function Host() {
    latest = useContextManagement({ message, initialContexts })
    return null
  }
  act(() => {
    root.render(<Host />)
  })
}

const fileSelection = (label: string): ChatContext => ({
  kind: 'file_selection',
  fileId: 'f1',
  fileName: 'notes.md',
  label,
  text: 'passage',
})

const tableSelection = (label: string, rowIds: string[]): ChatContext => ({
  kind: 'table_selection',
  tableId: 't1',
  tableName: 'Sales',
  label,
  rowIds,
})

describe('useContextManagement label sync', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('drops a chip whose label is only a prefix of a surviving one', () => {
    // `@notes.md:12` matches inside `@notes.md:12-40` — the token lookahead
    // rejects word characters but not `-`, so only the longer chip is really
    // present and the shorter must not linger and get sent.
    renderSync('look at @notes.md:12-40 please', [
      fileSelection('notes.md:12'),
      fileSelection('notes.md:12-40'),
    ])

    expect(latest.selectedContexts.map((c) => c.label)).toEqual(['notes.md:12-40'])
  })

  it('drops an un-ordinalized chip when only its ordinal twin remains', () => {
    renderSync('see @Sales (3 rows) (2) here', [
      tableSelection('Sales (3 rows)', ['r1', 'r2', 'r3']),
      tableSelection('Sales (3 rows) (2)', ['r7', 'r8', 'r9']),
    ])

    expect(latest.selectedContexts.map((c) => c.label)).toEqual(['Sales (3 rows) (2)'])
  })

  it('preserves the original context order, not the length-sorted one', () => {
    renderSync('@notes.md:12 and @notes.md:12-40', [
      fileSelection('notes.md:12'),
      fileSelection('notes.md:12-40'),
    ])

    expect(latest.selectedContexts.map((c) => c.label)).toEqual(['notes.md:12', 'notes.md:12-40'])
  })
})

describe('useContextManagement while the user types', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  /**
   * Under CPU load the browser runs each keystroke's input task before React's
   * scheduler task, so a keystroke commit must leave no render pending. React
   * counts every commit that leaves an update pending, and the 51st such commit
   * in a row makes the next `setState` anywhere throw "Maximum update depth
   * exceeded" (#185); in the chat that next `setState` was the Enter that queues
   * the follow-up, which was then lost. Keystrokes here are separate input
   * events with only microtasks between them, so the scheduler never runs: the
   * same ordering a loaded browser produces.
   */
  it('submits a long message typed faster than the React scheduler runs', async () => {
    const thrown: unknown[] = []
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    let submitted = ''

    function Composer() {
      const [message, setMessage] = useState('')
      const [lastSubmitted, setLastSubmitted] = useState('')
      useContextManagement({ message })
      submitted = lastSubmitted
      const guard = (update: () => void) => {
        try {
          update()
        } catch (error) {
          thrown.push(error)
        }
      }
      return (
        <textarea
          value={message}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
            guard(() => setMessage(event.target.value))
          }
          onKeyDown={(event) => {
            if (event.key === 'Enter') guard(() => setLastSubmitted(message))
          }}
        />
      )
    }

    act(() => {
      root.render(<Composer />)
    })
    const textarea = container.querySelector('textarea')
    if (!textarea) throw new Error('composer did not render')
    const setNativeValue = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value'
    )?.set
    if (!setNativeValue) throw new Error('textarea value setter missing')

    const followUp = 'please also summarize the second quarter numbers by region and team'
    for (let i = 1; i <= followUp.length; i++) {
      setNativeValue.call(textarea, followUp.slice(0, i))
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    }
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await Promise.resolve()

    expect(thrown).toEqual([])
    expect(
      consoleError.mock.calls.filter((call) => String(call[0]).includes('Maximum update depth'))
    ).toEqual([])
    expect(submitted).toBe(followUp)
  })
})
