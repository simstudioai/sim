/**
 * @vitest-environment node
 */
import type { ReactNode, SVGProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { getBlockByToolName } from '@/blocks/registry'
import { ToolCallItem } from './tool-call-item'

vi.mock('@/components/ui', () => ({
  ShimmerText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))

describe('ToolCallItem', () => {
  it.each(['executing', 'success', 'error', 'cancelled'] as const)(
    'renders the %s tool row without an icon',
    (status) => {
      const markup = renderToStaticMarkup(
        <ToolCallItem
          toolName='grep'
          displayTitle={status === 'executing' ? 'Searching for Pulse' : 'Searched for Pulse'}
          status={status}
        />
      )

      expect(markup).not.toContain('<svg')
    }
  )

  it('does not restore a progressive streamed title after the tool settles', () => {
    const markup = renderToStaticMarkup(
      <ToolCallItem
        toolName='workspace_file'
        displayTitle='Wrote brief.md'
        status='success'
        streamingArgs='{"operation":"update","title":"brief.md"}'
      />
    )

    expect(markup).toContain('Wrote brief.md')
    expect(markup).not.toContain('Writing brief.md')
  })

  it('renders the owning integration icon for a resolved integration operation', () => {
    vi.mocked(getBlockByToolName).mockReturnValueOnce({
      name: 'Gmail',
      icon: (props: SVGProps<SVGSVGElement>) => <svg {...props} data-testid='gmail-icon' />,
    } as ReturnType<typeof getBlockByToolName>)
    const markup = renderToStaticMarkup(
      <ToolCallItem
        toolName='gmail_read_v2'
        displayTitle='Gmail: Searching for invoice emails'
        status='executing'
      />
    )

    expect(markup).toContain('<svg')
    expect(markup).toContain('Gmail: Searching for invoice emails')
  })
})
