/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SlackAppManifest } from '@/components/integrations/slack-app-manifest'
import { createSlackSearchManifest } from '@/lib/slack-search/manifest'

const writeText = vi.fn()
let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  writeText.mockReset().mockResolvedValue(undefined)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function render(manifest: string, disabled = false, onCopy = vi.fn()) {
  await act(async () =>
    root.render(<SlackAppManifest manifest={manifest} disabled={disabled} onCopy={onCopy} />)
  )
}
async function copy() {
  await act(async () => container.querySelector('button')!.click())
}

describe('Slack manifest copying', () => {
  it('copies the current generated manifest, including its name, scopes, and environment', async () => {
    const original = JSON.stringify(
      createSlackSearchManifest('First app', 'Search', 'https://first.sim.test')
    )
    const updated = JSON.stringify(
      createSlackSearchManifest('Second app', 'Search', 'https://second.sim.test', ['files:write'])
    )
    await render(original)
    await copy()
    expect(writeText).toHaveBeenLastCalledWith(original)
    expect(container.querySelector('[role="status"]')).toHaveTextContent('Manifest copied')
    await render(updated)
    expect(container.querySelector('[role="status"]')).toBeNull()
    await copy()
    expect(writeText).toHaveBeenLastCalledWith(updated)
    expect(container.querySelector('button')).toHaveTextContent('Copy manifest')
    expect(container.querySelector('details')).not.toHaveAttribute('open')
  })

  it('reports a failed repeat copy without stale success and allows retry', async () => {
    const onCopy = vi.fn()
    await render('{}', false, onCopy)
    await copy()
    writeText.mockRejectedValueOnce(new Error('Denied'))
    await copy()
    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(container.querySelector('[role="alert"]')).toHaveTextContent('Allow clipboard access')
    expect(onCopy).toHaveBeenCalledTimes(1)
    await copy()
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(onCopy).toHaveBeenCalledTimes(2)
  })

  it('does not copy an unavailable or empty manifest', async () => {
    await render('{}', true)
    await copy()
    await render('')
    await copy()
    expect(writeText).not.toHaveBeenCalled()
  })
})
