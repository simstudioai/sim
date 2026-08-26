/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetBlock } = vi.hoisted(() => ({
  mockGetBlock: vi.fn(),
}))

vi.mock('@/blocks/registry', () => ({
  getBlock: mockGetBlock,
  getBlockByToolName: vi.fn(),
  getLatestBlock: vi.fn(),
}))

vi.mock('@/lib/auth/auth-client', () => ({
  useSession: vi.fn(() => ({ data: null, isPending: false })),
}))

interface MockAgentGroupItem {
  type: string
  data?: { id: string; displayTitle: string }
}

vi.mock('./components', () => ({
  AgentGroup: ({ items }: { items: MockAgentGroupItem[] }) => (
    <div>
      {items.map((item) => item.data && <span key={item.data.id}>{item.data.displayTitle}</span>)}
    </div>
  ),
  ChatContent: () => null,
  CircleStop: () => null,
  Options: () => null,
  PendingTagIndicator: () => null,
}))

import type { ContentBlock } from '@/app/workspace/[workspaceId]/home/types'
import { notifyBlockOverlayChanged } from '@/blocks/custom/client-overlay'
import { MessageContent } from './message-content'

describe('MessageContent custom-block hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  it('refreshes a read title when the custom-block registry hydrates after mount', () => {
    mockGetBlock.mockReturnValue(undefined)
    const blocks: ContentBlock[] = [
      {
        type: 'tool_call',
        toolCall: {
          id: 'read-custom-block',
          name: 'read',
          status: 'success',
          params: {
            path: 'organization/custom-blocks/custom_block_invoice_parser.json',
          },
        },
        timestamp: 1,
      },
    ]
    const container = document.createElement('div')
    const root: Root = createRoot(container)

    act(() => {
      root.render(<MessageContent blocks={blocks} fallbackContent='' isStreaming={false} />)
    })
    expect(container.textContent).toContain('Read Custom block invoice parser')

    mockGetBlock.mockReturnValue({
      type: 'custom_block_invoice_parser',
      name: 'Invoice Parser',
      icon: () => null,
    })
    act(() => notifyBlockOverlayChanged())

    expect(container.textContent).toContain('Read Invoice Parser')
    expect(container.textContent).not.toContain('Read Custom block invoice parser')
    act(() => root.unmount())
  })
})
