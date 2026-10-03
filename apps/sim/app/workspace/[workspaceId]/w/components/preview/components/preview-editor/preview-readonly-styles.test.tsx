/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { nextNavigationMock, nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => nextNavigationMock)
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
const piiConfig: SubBlockConfig = {
  id: 'pii-types',
  type: 'grouped-checkbox-list',
  title: 'PII Types',
  options: [{ id: 'email', label: 'Email', group: 'Personal' }],
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  nextNavigationMockFns.mockUseParams.mockReturnValue({ workspaceId: 'workspace-1' })
  nextNavigationMockFns.mockUsePathname.mockReturnValue('/workspace/workspace-1/w/workflow-1')
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
              <SubBlock
                blockId='block-1'
                config={piiConfig}
                isPreview
                subBlockValues={{ 'pii-types': { value: ['email'] } }}
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

    const preview = container.querySelector('[data-testid="preview"]')
    const disabled = container.querySelector('[data-testid="disabled"]')
    if (!preview || !disabled) throw new Error('Missing preview or disabled section')
    const previewSwitch = preview.querySelector<HTMLButtonElement>('[role="switch"]')
    const disabledSwitch = disabled.querySelector<HTMLButtonElement>('[role="switch"]')
    if (!previewSwitch || !disabledSwitch) throw new Error('Missing preview or disabled switch')

    expect(preview.querySelector('[data-preview-readonly]')).not.toBeNull()
    expect(previewSwitch.hasAttribute('disabled')).toBe(true)
    expect(previewSwitch.getAttribute('aria-checked')).toBe('true')
    expect(getComputedStyle(previewSwitch).opacity).toBe('1')
    expect(getComputedStyle(previewSwitch).pointerEvents).toBe('none')
    const piiTrigger = Array.from(preview.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Configure PII Types')
    )
    if (!piiTrigger) throw new Error('Missing PII configuration trigger')
    expect(piiTrigger.disabled).toBe(true)
    expect(piiTrigger.hasAttribute('data-preview-full-opacity')).toBe(true)
    const removeButton = Array.from(preview.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Remove file')
    )
    if (!removeButton) throw new Error('Missing remove file button')
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
