/**
 * @vitest-environment jsdom
 */
import { act, type ComponentProps, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/emcn', () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Chip: ({ children, ref, onClick, disabled, 'aria-label': label }: ComponentProps<'button'>) => (
    <button ref={ref} type='button' onClick={onClick} disabled={disabled} aria-label={label}>
      {children}
    </button>
  ),
  Switch: () => null,
}))

vi.mock('@sim/emcn/icons', () => ({
  ArrowLeft: () => null,
  ChevronDown: () => null,
  ChevronUp: () => null,
  FileText: () => null,
}))

vi.mock('@/components/icons', () => ({
  ConfluenceIcon: () => null,
  GoogleDriveIcon: () => null,
  NotionIcon: () => null,
}))

vi.mock('@/app/workspace/[workspaceId]/components/resource/components/resource-options', () => ({
  ResourceOptions: () => null,
}))

import { KnowledgeDocumentDetail } from '@/app/(landing)/knowledge/components/knowledge-sources-preview/components/knowledge-document-detail/knowledge-document-detail'
import { KNOWLEDGE_PREVIEW_SOURCES } from '@/app/(landing)/knowledge/components/knowledge-sources-preview/data'

const PREVIEW_DOCUMENT = KNOWLEDGE_PREVIEW_SOURCES[0].documents[0]
let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root.render(<KnowledgeDocumentDetail document={PREVIEW_DOCUMENT} />))
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

function button(label: string): HTMLButtonElement {
  const element = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.getAttribute('aria-label') === label || button.textContent === label
  )
  if (!element) throw new Error(`Missing button: ${label}`)
  return element
}

describe('KnowledgeDocumentDetail focus', () => {
  it.each([0, 1])('moves focus into chunk %i and restores its row on return', (index) => {
    expect(document.activeElement).toBe(document.body)
    const label = `Open chunk ${index}: ${PREVIEW_DOCUMENT.chunks[index].content}`
    const rowButton = button(label)
    rowButton.focus()
    act(() => rowButton.click())

    expect(rowButton.isConnected).toBe(false)
    const backButton = button('Back to chunks')
    expect(document.activeElement).toBe(backButton)

    act(() => backButton.click())
    expect(document.activeElement).toBe(button(label))
  })
})
