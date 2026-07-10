import { describe, expect, it } from 'vitest'
import { buildSlackManifest } from '@/triggers/slack/capabilities'

const opts = { appName: 'Test Bot', webhookUrl: 'https://sim.test/api/webhooks/slack' }

function settingsOf(manifest: Record<string, unknown>) {
  return manifest.settings as Record<string, unknown>
}

describe('buildSlackManifest - interactivity', () => {
  it('emits settings.interactivity when the interactivity capability is active', () => {
    const manifest = buildSlackManifest(new Set(['action_interactivity']), opts)
    expect(settingsOf(manifest).interactivity).toEqual({
      is_enabled: true,
      request_url: opts.webhookUrl,
    })
  })

  it('omits settings.interactivity when the capability is absent', () => {
    const manifest = buildSlackManifest(new Set(['action_send']), opts)
    expect(settingsOf(manifest).interactivity).toBeUndefined()
  })

  it('enables interactivity independently of event subscriptions', () => {
    // No bot_events (interactivity-only bot) still gets the interactivity block.
    const manifest = buildSlackManifest(new Set(['action_interactivity']), opts)
    const settings = settingsOf(manifest)
    expect(settings.event_subscriptions).toBeUndefined()
    expect(settings.interactivity).toBeDefined()
  })
})

describe('buildSlackManifest - description', () => {
  it('emits display_information.description and reuses it as the assistant description', () => {
    const manifest = buildSlackManifest(new Set(['action_assistant']), {
      ...opts,
      description: 'Answers support questions.',
    })
    expect(manifest.display_information).toEqual({
      name: 'Test Bot',
      description: 'Answers support questions.',
    })
    const features = manifest.features as Record<string, Record<string, unknown>>
    expect(features.assistant_view.assistant_description).toBe('Answers support questions.')
  })

  it('omits the description key and falls back for the assistant when absent', () => {
    const manifest = buildSlackManifest(new Set(['action_assistant']), opts)
    expect(manifest.display_information).toEqual({ name: 'Test Bot' })
    const features = manifest.features as Record<string, Record<string, unknown>>
    expect(features.assistant_view.assistant_description).toBe(
      'Test Bot — an AI assistant powered by Sim.'
    )
  })
})
