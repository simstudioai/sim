/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode, type SVGProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { notifyBlockOverlayChanged } from '@/blocks/custom/client-overlay'
import { getBlock, getBlockByToolName } from '@/blocks/registry'
import { ToolCallItem } from './tool-call-item'

vi.mock('@/components/ui', () => ({
  ShimmerText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))

describe('ToolCallItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  it.each(['executing', 'success', 'error', 'cancelled'] as const)(
    'renders the %s tool row with its EMCN icon',
    (status) => {
      const markup = renderToStaticMarkup(
        <ToolCallItem
          toolName='grep'
          displayTitle={status === 'executing' ? 'Searching for Pulse' : 'Searched for Pulse'}
          status={status}
        />
      )

      expect(markup).toContain('<svg')
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

  it.each([
    ['executing', 'Checking the invoice totals'],
    ['success', 'Checked the invoice totals'],
    ['error', 'Failed checking the invoice totals'],
    ['cancelled', 'Stopped checking the invoice totals'],
    ['rejected', 'Failed checking the invoice totals'],
    ['skipped', 'Skipped checking the invoice totals'],
  ] as const)(
    'projects %s from the actual tool status onto the model description',
    (status, title) => {
      const markup = renderToStaticMarkup(
        <ToolCallItem
          toolName='prepare_file_edit'
          displayTitle='Editing report.md'
          activityDescription='Checking the invoice totals'
          status={status}
          streamingArgs='{"operation":"patch","title":"report.md"}'
        />
      )

      expect(markup).toContain(title)
      expect(markup).not.toContain('report.md')
    }
  )

  it.each(['   ', 'a'.repeat(161)])(
    'uses the existing title for an invalid description',
    (activityDescription) => {
      const markup = renderToStaticMarkup(
        <ToolCallItem
          toolName='grep'
          displayTitle='Searching files'
          activityDescription={activityDescription}
          status='executing'
        />
      )

      expect(markup).toContain('Searching files')
    }
  )

  it('keeps an executing wait countdown in place of the model phrase', () => {
    const markup = renderToStaticMarkup(
      <ToolCallItem
        toolName='wait'
        displayTitle='Waiting'
        activityDescription='Waiting for the export'
        status='executing'
        params={{ seconds: 10 }}
      />
    )

    expect(markup).toContain('10s')
    expect(markup).not.toContain('Waiting for the export')
  })

  it('renders model descriptions as text, without interpreting markup', () => {
    const markup = renderToStaticMarkup(
      <ToolCallItem
        toolName='read'
        displayTitle='Reading a page'
        activityDescription='Reading <script>alert(1)</script>'
        status='executing'
      />
    )

    expect(markup).toContain('&lt;script&gt;')
    expect(markup).not.toContain('<script>')
  })

  it('does not let model-authored outcome wording override a failure', () => {
    const markup = renderToStaticMarkup(
      <ToolCallItem
        toolName='read'
        displayTitle='Reading a page'
        activityDescription='Stopped checking invoices'
        status='error'
      />
    )

    expect(markup).toContain('Failed checking invoices')
    expect(markup).not.toContain('Stopped checking invoices')
  })

  it('defensively applies the completed verb for every successful tool row', () => {
    const markup = renderToStaticMarkup(
      <ToolCallItem toolName='diff_workflows' displayTitle='Comparing workflows' status='success' />
    )

    expect(markup).toContain('Compared workflows')
    expect(markup).not.toContain('Comparing workflows')
  })

  it('renders a completed browser takeover as an answered question recap', () => {
    const markup = renderToStaticMarkup(
      <ToolCallItem
        toolName='browser_request_takeover'
        displayTitle='Resumed browser control'
        status='success'
        params={{ reason: 'Pick a match from the draw.' }}
        result={{ success: true, output: { userInstruction: 'Open the second match' } }}
      />
    )

    expect(markup).toContain('Pick a match from the draw.')
    expect(markup).toContain('Open the second match')
    expect(markup).not.toContain('Resumed browser control')
  })

  it('recaps Continue when browser control resumed without a custom instruction', () => {
    const markup = renderToStaticMarkup(
      <ToolCallItem
        toolName='browser_request_takeover'
        displayTitle='Resumed browser control'
        status='success'
        params={{ reason: 'Sign in to Notion.' }}
        result={{ success: true }}
      />
    )

    expect(markup).toContain('Sign in to Notion.')
    expect(markup).toContain('Continue')
  })

  it('renders the owning integration icon for a resolved integration operation', () => {
    vi.mocked(getBlockByToolName).mockReturnValueOnce({
      name: 'Gmail',
      icon: (props: SVGProps<SVGSVGElement>) => <svg {...props} data-testid='gmail-icon' />,
    } as ReturnType<typeof getBlockByToolName>)
    const markup = renderToStaticMarkup(
      <ToolCallItem
        toolName='gmail_read_v2'
        displayTitle='Searching for invoice emails'
        status='executing'
      />
    )

    expect(markup).toContain('<svg')
    expect(markup).toContain('Searching for invoice emails')
  })

  it('renders the integration icon from a provisional gateway toolId', () => {
    vi.mocked(getBlockByToolName).mockReturnValueOnce({
      name: 'Gmail',
      icon: (props: SVGProps<SVGSVGElement>) => <svg {...props} data-testid='gmail-icon' />,
    } as ReturnType<typeof getBlockByToolName>)
    const markup = renderToStaticMarkup(
      <ToolCallItem
        toolName='call_integration_tool'
        displayTitle='Read recent emails'
        status='executing'
        streamingArgs='{"toolId":"gmail_read_v2","description":"Read recent emails"'
      />
    )

    expect(markup).toContain('<svg')
    expect(markup).toContain('Read recent emails')
  })

  it('refreshes the read icon when custom blocks hydrate after mount', () => {
    vi.mocked(getBlock).mockReturnValue(undefined)
    const container = document.createElement('div')
    const root: Root = createRoot(container)

    act(() => {
      root.render(
        <ToolCallItem
          toolName='read'
          displayTitle='Read Custom block invoice parser'
          status='success'
          params={{
            path: 'organization/custom-blocks/custom_block_invoice_parser.json',
          }}
        />
      )
    })
    expect(container.querySelector('[data-testid="custom-block-icon"]')).toBeNull()

    vi.mocked(getBlock).mockReturnValue({
      type: 'custom_block_invoice_parser',
      name: 'Invoice Parser',
      icon: (props: SVGProps<SVGSVGElement>) => <svg {...props} data-testid='custom-block-icon' />,
    } as ReturnType<typeof getBlock>)
    act(() => notifyBlockOverlayChanged())

    expect(container.querySelector('[data-testid="custom-block-icon"]')).not.toBeNull()
    act(() => root.unmount())
  })
})
