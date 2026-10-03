/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SlackAppManifest } from '@/components/integrations/slack-app-manifest'
import { buildSlackAppCreationUrl } from '@/lib/integrations/slack-manifest'
import { createSlackSearchManifest } from '@/lib/slack-search/manifest'

const writeText = vi.fn()
let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.useFakeTimers()
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
  vi.useRealTimers()
})

async function render(manifest: string, disabled = false, createAppUrl?: string) {
  await act(async () =>
    root.render(
      <SlackAppManifest manifest={manifest} disabled={disabled} createAppUrl={createAppUrl} />
    )
  )
}
async function copy() {
  await act(async () => container.querySelector('button')!.click())
}

describe('Slack manifest copying', () => {
  it('opens the current manifest directly in Slack without requiring clipboard access', async () => {
    for (const description of ['Research & support #1', 'Updated app % / 日本語']) {
      const manifest = JSON.stringify(
        createSlackSearchManifest('Research app', description, 'https://sim.test')
      )
      await render(manifest, false, buildSlackAppCreationUrl(manifest))
      const link = container.querySelector('a')!
      const url = new URL(link.href)
      expect(url.origin).toBe('https://api.slack.com')
      expect(url.searchParams.get('new_app')).toBe('1')
      expect(url.searchParams.get('manifest_json')).toBe(manifest)
      expect(writeText).not.toHaveBeenCalled()
    }
  })

  it('reports a failed repeat copy without stale success and allows retry', async () => {
    await render('{}')
    await copy()
    writeText.mockRejectedValueOnce(new Error('Denied'))
    await copy()
    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(container.querySelector('[role="alert"]')).toHaveTextContent('Allow clipboard access')
    await copy()
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(writeText).toHaveBeenCalledTimes(3)
  })
})
