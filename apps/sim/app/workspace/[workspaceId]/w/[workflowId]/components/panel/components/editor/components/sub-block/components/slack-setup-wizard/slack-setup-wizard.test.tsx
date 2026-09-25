/** @vitest-environment jsdom */
import { act, useState } from 'react'
import {
  resetWorkflowRegistryMockState,
  workflowRegistryStoreMock,
} from '@sim/testing/mocks/workflow-registry-store.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loading: true,
}))
vi.mock('@/hooks/use-webhook-management', () => ({
  useWebhookManagement: () => ({
    webhookUrl: 'https://sim.test/api/webhooks/trigger/block-1',
    isLoading: mocks.loading,
  }),
}))
vi.mock('@/stores/workflows/registry/store', () => workflowRegistryStoreMock)
vi.mock('@/stores/workflows/subblock/store', () => ({
  useSubBlockStore: (selector: (state: { workflowValues: object }) => unknown) =>
    selector({ workflowValues: {} }),
}))
vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value',
  () => ({
    useSubBlockValue: (_blockId: string, key: string) =>
      useState(key === 'botDisplayName' ? 'Test workflow bot' : ''),
  })
)

import { SlackSetupWizard } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/slack-setup-wizard/slack-setup-wizard'

resetWorkflowRegistryMockState({ activeWorkflowId: 'workflow-1' })

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.loading = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
async function render() {
  await act(async () => root.render(<SlackSetupWizard blockId='block-1' />))
}
function button(name: string) {
  const element = [...document.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === name
  )
  expect(element).toBeDefined()
  return element!
}
async function click(name: string) {
  await act(async () => button(name).click())
}
async function fill(placeholder: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)!
  await act(async () => input.focus())
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

it('uses the existing default name when the bot name is cleared', async () => {
  mocks.loading = false
  await render()
  await click('Set up Slack app')
  await fill('Sim Workflow Bot', '')
  expect(button('Next')).not.toBeDisabled()
  await click('Next')
  const link = document.querySelector<HTMLAnchorElement>('a[href*="manifest_json"]')!
  const manifest = JSON.parse(new URL(link.href).searchParams.get('manifest_json')!)
  expect(manifest.display_information.name).toBe('Sim Workflow Bot')
})
