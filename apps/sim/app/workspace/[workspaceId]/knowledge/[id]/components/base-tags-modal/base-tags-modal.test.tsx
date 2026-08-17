/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCopy, mockRefetchTagUsage } = vi.hoisted(() => ({
  mockCopy: vi.fn(),
  mockRefetchTagUsage: vi.fn(),
}))

vi.mock('@sim/emcn', async () => {
  const { useState } = await import('react')

  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>

  return {
    Button: ({
      children,
      variant: _variant,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => (
      <button {...props}>{children}</button>
    ),
    ChipCombobox: () => null,
    ChipConfirmModal: ({ open, children }: { open: boolean; children?: ReactNode }) =>
      open ? <div>{children}</div> : null,
    ChipInput: () => null,
    ChipModal: ({ open, children }: { open: boolean; children?: ReactNode }) =>
      open ? <div>{children}</div> : null,
    ChipModalBody: Container,
    ChipModalField: ({ children, title }: { children?: ReactNode; title?: ReactNode }) => (
      <div>
        {title}
        {children}
      </div>
    ),
    ChipModalFooter: Container,
    ChipModalHeader: Container,
    handleKeyboardActivation: vi.fn(),
    Tooltip: {
      Root: Container,
      Trigger: Container,
      Content: Container,
    },
    useCopyToClipboard: () => {
      const [copied, setCopied] = useState(false)
      return {
        copied,
        copy: async (text: string) => {
          await mockCopy(text)
          setCopied(true)
          return true
        },
      }
    },
  }
})

vi.mock('@sim/emcn/icons', () => ({
  Check: (props: React.SVGProps<SVGSVGElement>) => <svg data-icon='check' {...props} />,
  Duplicate: (props: React.SVGProps<SVGSVGElement>) => <svg data-icon='duplicate' {...props} />,
  Trash: (props: React.SVGProps<SVGSVGElement>) => <svg data-icon='trash' {...props} />,
}))

vi.mock('@/app/workspace/[workspaceId]/knowledge/components', () => ({
  getDocumentIcon: () => (props: React.SVGProps<SVGSVGElement>) => <svg {...props} />,
}))

vi.mock('@/hooks/kb/use-knowledge-base-tag-definitions', () => ({
  useKnowledgeBaseTagDefinitions: () => ({
    tagDefinitions: [
      {
        id: 'tag-definition-uuid',
        tagSlot: 'tag1',
        displayName: 'category',
        fieldType: 'text',
      },
    ],
  }),
}))

vi.mock('@/hooks/queries/kb/knowledge', () => ({
  useCreateTagDefinition: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useDeleteTagDefinition: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useTagUsageQuery: () => ({
    data: [
      {
        tagName: 'category',
        tagSlot: 'tag1',
        documentCount: 0,
        documents: [],
      },
    ],
    refetch: mockRefetchTagUsage,
  }),
}))

import { BaseTagsModal } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/base-tags-modal/base-tags-modal'

let container: HTMLDivElement
let root: Root

describe('BaseTagsModal tag ID copy control', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mockCopy.mockResolvedValue(undefined)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  it('copies the tag UUID, shows feedback, and does not open tag usage', async () => {
    await act(async () => {
      root.render(<BaseTagsModal open onOpenChange={vi.fn()} knowledgeBaseId='knowledge-base-id' />)
    })

    const copyButton = container.querySelector(
      'button[aria-label="Copy category tag ID"]'
    ) as HTMLButtonElement
    const deleteButton = container.querySelector(
      'button[aria-label="Delete category tag"]'
    ) as HTMLButtonElement

    expect(copyButton).toBeTruthy()
    expect(deleteButton).toBeTruthy()
    expect(copyButton.querySelector('[data-icon="duplicate"]')).toBeTruthy()
    expect(
      copyButton.compareDocumentPosition(deleteButton) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()

    await act(async () => {
      copyButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mockCopy).toHaveBeenCalledWith('tag-definition-uuid')
    expect(mockRefetchTagUsage).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Copied')
    expect(copyButton.querySelector('svg')?.classList.contains('text-[var(--text-success)]')).toBe(
      true
    )
  })
})
