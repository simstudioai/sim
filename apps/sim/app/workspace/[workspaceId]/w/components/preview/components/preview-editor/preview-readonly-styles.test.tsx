/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useParams: () => ({ workspaceId: 'workspace-1' }) }))
vi.mock('@/hooks/use-webhook-management', () => ({
  useWebhookManagement: () => ({ webhookUrl: null }),
}))
vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value',
  () => ({ useSubBlockValue: () => [undefined, vi.fn()] })
)

import { SubBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/sub-block'
import { READONLY_PREVIEW_STYLES } from '@/app/workspace/[workspaceId]/w/components/preview/components/preview-editor/preview-readonly-styles'
import type { SubBlockConfig } from '@/blocks/types'

const config: SubBlockConfig = { id: 'enabled', type: 'switch', title: 'Enabled' }

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('workflow preview read-only appearance', () => {
  it('shows a preview value at full opacity while retaining the disabled interaction state', () => {
    act(() =>
      root.render(
        <>
          <style>{`button[disabled] { opacity: 0.5; } ${READONLY_PREVIEW_STYLES}`}</style>
          <div className='readonly-preview'>
            <div data-testid='preview'>
              <SubBlock
                blockId='block-1'
                config={config}
                isPreview
                subBlockValues={{ enabled: { value: true } }}
              />
              <div data-preview-readonly>
                <button type='button' disabled>
                  Remove file
                </button>
              </div>
            </div>
            <div data-testid='disabled'>
              <SubBlock blockId='block-1' config={config} disabled />
            </div>
          </div>
        </>
      )
    )

    const preview = container.querySelector('[data-testid="preview"]')!
    const previewSwitch = preview.querySelector('[role="switch"]') as HTMLButtonElement
    const disabled = container.querySelector('[data-testid="disabled"]')!
    const disabledSwitch = disabled.querySelector('[role="switch"]') as HTMLButtonElement

    expect(preview.querySelector('[data-preview-readonly]')).not.toBeNull()
    expect(previewSwitch.hasAttribute('disabled')).toBe(true)
    expect(previewSwitch.getAttribute('aria-checked')).toBe('true')
    expect(getComputedStyle(previewSwitch).opacity).toBe('1')
    expect(getComputedStyle(previewSwitch).pointerEvents).toBe('none')
    const removeButton = preview.querySelector('button:not([role="switch"])') as HTMLButtonElement
    expect(getComputedStyle(removeButton).pointerEvents).toBe('none')
    expect(getComputedStyle(removeButton).opacity).toBe('0.5')

    act(() => {
      previewSwitch.click()
      previewSwitch.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    })
    expect(previewSwitch.getAttribute('aria-checked')).toBe('true')

    expect(disabled.querySelector('[data-preview-readonly]')).toBeNull()
    expect(disabledSwitch.hasAttribute('disabled')).toBe(true)
    expect(getComputedStyle(disabledSwitch).opacity).toBe('0.5')
  })
})
