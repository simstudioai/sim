/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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

  it('keeps both when both tokens are present', () => {
    renderSync('@notes.md:12 and @notes.md:12-40', [
      fileSelection('notes.md:12'),
      fileSelection('notes.md:12-40'),
    ])

    expect(latest.selectedContexts.map((c) => c.label).sort()).toEqual([
      'notes.md:12',
      'notes.md:12-40',
    ])
  })

  it('preserves the original context order, not the length-sorted one', () => {
    renderSync('@notes.md:12 and @notes.md:12-40', [
      fileSelection('notes.md:12'),
      fileSelection('notes.md:12-40'),
    ])

    expect(latest.selectedContexts.map((c) => c.label)).toEqual(['notes.md:12', 'notes.md:12-40'])
  })

  it('still tolerates trailing punctuation after a mention', () => {
    renderSync('ask @notes.md:12-40, then stop', [fileSelection('notes.md:12-40')])

    expect(latest.selectedContexts).toHaveLength(1)
  })
})
