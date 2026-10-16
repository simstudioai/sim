/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MentionRowContent } from '@/app/workspace/[workspaceId]/home/components/user-input/components/plus-menu-dropdown/mention-row-content'

let container: HTMLDivElement
let root: Root

/** Stands in for a family renderer that pins trailing content with `ml-auto`, as the log row does. */
function LogLikeRow() {
  return (
    <>
      <span className='truncate'>Daily digest</span>
      <span data-testid='trailing' className='ml-auto flex-shrink-0'>
        2m ago
      </span>
    </>
  )
}

function renderRow(node: React.ReactNode) {
  act(() => {
    root.render(<button type='button'>{node}</button>)
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('MentionRowContent', () => {
  it('leaves a location-less row unwrapped so `ml-auto` still reaches the row edge', () => {
    renderRow(
      <MentionRowContent>
        <LogLikeRow />
      </MentionRowContent>
    )

    const trailing = container.querySelector('[data-testid="trailing"]')
    expect(trailing).not.toBeNull()
    expect(trailing?.parentElement?.tagName).toBe('BUTTON')
  })

  it('wraps and caps the name only when a location follows it', () => {
    renderRow(
      <MentionRowContent location={{ familyType: 'file', parentNames: ['Growth'] }}>
        <span>Enterprise</span>
      </MentionRowContent>
    )

    const name = container.querySelector('button > span')
    expect(name?.className).toContain('max-w-[65%]')
    expect(name?.className).toContain('flex-shrink-0')
    expect(container.textContent).toContain('Files')
    expect(container.textContent).toContain('Growth')
  })
})
