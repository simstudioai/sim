/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { liveSearchSourceMeta } from '@/lib/sim-search/live/source-settings'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'

describe('live source fields', () => {
  it.each([
    ['google_drive', 'folderSelector', 'google.drive'],
    ['gmail', 'labelSelector', 'gmail.labels'],
    ['google_calendar', 'calendarSelector', 'google.calendar'],
    ['confluence', 'spaceSelector', 'confluence.spaces'],
    ['coda', 'docSelector', 'coda.docs'],
  ])('keeps the %s resource selector in the source editor', (provider, fieldId, selectorKey) => {
    const meta = liveSearchSourceMeta(CONNECTOR_META_REGISTRY[provider], true)
    expect(meta?.configFields.find((field) => field.id === fieldId)).toMatchObject({
      type: 'selector',
      selectorKey,
    })
    if (provider === 'gmail' || provider === 'google_calendar')
      expect(
        meta?.configFields.find((field) => field.id === fieldId)?.hideInAdminMode
      ).toBeUndefined()
  })

  it('uses the GitHub App repository picker on create and edit while hiding index-only fields', () => {
    const meta = liveSearchSourceMeta(CONNECTOR_META_REGISTRY.github, true, {
      githubInstallation: true,
    })
    expect(meta?.configFields.find((field) => field.id === 'repository')).toMatchObject({
      type: 'selector',
      selectorKey: 'github.installationRepositories',
    })
    expect(meta?.configFields.map((field) => field.id)).toEqual([
      'repository',
      'pathPrefix',
      'extensions',
    ])
  })

  it('preserves the installation repository selector when using the indexed backend', () => {
    const meta = liveSearchSourceMeta(CONNECTOR_META_REGISTRY.github, false, {
      githubInstallation: true,
    })
    expect(meta?.configFields.find((field) => field.id === 'repository')).toMatchObject({
      type: 'selector',
      selectorKey: 'github.installationRepositories',
    })
    expect(meta?.configFields.map((field) => field.id)).toEqual(
      CONNECTOR_META_REGISTRY.github.configFields.map((field) => field.id)
    )
  })

  it.each(['google_drive', 'gmail', 'google_calendar'])(
    'requires the delegated administrator before browsing %s',
    (provider) => {
      const meta = liveSearchSourceMeta(CONNECTOR_META_REGISTRY[provider], true)
      expect(meta?.configFields.find((field) => field.id === 'adminEmail')).toMatchObject({
        requiredInAdminMode: true,
      })
    }
  )
})
