/** @vitest-environment jsdom */
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loading: true,
  copy: vi.fn(),
}))
vi.mock('@/hooks/use-webhook-management', () => ({
  useWebhookManagement: () => ({
    webhookUrl: 'https://sim.test/api/webhooks/trigger/block-1',
    isLoading: mocks.loading,
  }),
}))
vi.mock('@/stores/workflows/registry/store', () => ({ useWorkflowRegistry: () => 'workflow-1' }))
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

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('navigator', { clipboard: { writeText: mocks.copy } })
  mocks.loading = true
  mocks.copy.mockReset().mockResolvedValue(undefined)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
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

it('waits for the webhook URL without requiring an early deployment, then copies the current manifest', async () => {
  await render()
  await click('Set up Slack app')
  await click('Next')
  expect(button('Copy manifest')).toBeDisabled()
  expect(button('Next')).toBeDisabled()
  expect(document.body).toHaveTextContent('Loading the webhook URL')
  expect(document.body).not.toHaveTextContent('Deploy once')
  mocks.loading = false
  await render()
  await click('Copy manifest')
  const manifest = JSON.parse(mocks.copy.mock.calls[0][0])
  expect(manifest.display_information.name).toBe('Test workflow bot')
  expect(manifest.settings.event_subscriptions.request_url).toBe(
    'https://sim.test/api/webhooks/trigger/block-1'
  )
})

it('collects the token before the signing secret and retains both when going back', async () => {
  mocks.loading = false
  await render()
  await click('Set up Slack app')
  await click('Next')
  await click('Next')
  expect(button('Next')).toBeDisabled()
  expect(document.querySelector('input[placeholder="xoxb-..."]')).toHaveAccessibleName('Bot Token')
  await fill('xoxb-...', 'xoxb-test-token')
  await click('Next')
  expect(button('Next')).toBeDisabled()
  expect(
    document.querySelector('input[placeholder="Paste your signing secret"]')
  ).toHaveAccessibleName('Signing Secret')
  await fill('Paste your signing secret', 'test-secret')
  await click('Back')
  await click('Next')
  expect(button('Next')).not.toBeDisabled()
  await click('Next')
  expect(document.body).toHaveTextContent('save and deploy the workflow with these credentials')
  expect(document.body).toHaveTextContent('verify the event Request URL')
  expect(document.body).not.toHaveTextContent('automatically')
})

it('uses the existing default name when the bot name is cleared', async () => {
  mocks.loading = false
  await render()
  await click('Set up Slack app')
  await fill('Sim Workflow Bot', '')
  expect(button('Next')).not.toBeDisabled()
  await click('Next')
  await click('Copy manifest')
  expect(JSON.parse(mocks.copy.mock.calls[0][0]).display_information.name).toBe('Sim Workflow Bot')
})
