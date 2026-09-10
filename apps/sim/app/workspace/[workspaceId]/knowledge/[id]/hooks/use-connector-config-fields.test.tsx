/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/icons', () => ({
  GmailIcon: () => null,
  GoogleCalendarIcon: () => null,
  GoogleDriveIcon: () => null,
}))

import { describeSearchSource, SOURCE_LABELS_KEY } from '@/lib/sim-search/source-identity'
import {
  type UseConnectorConfigFieldsOptions,
  type UseConnectorConfigFieldsResult,
  useConnectorConfigFields,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-config-fields'
import { gmailConnectorMeta } from '@/connectors/gmail/meta'
import { googleCalendarConnectorMeta } from '@/connectors/google-calendar/meta'
import { googleDriveConnectorMeta } from '@/connectors/google-drive/meta'
import type { ConnectorMeta } from '@/connectors/types'

describe('useConnectorConfigFields member configuration', () => {
  let container: HTMLDivElement
  let root: Root
  let current: UseConnectorConfigFieldsResult

  function Probe(options: UseConnectorConfigFieldsOptions) {
    current = useConnectorConfigFields(options)
    return null
  }

  function render(options: Partial<UseConnectorConfigFieldsOptions> = {}) {
    act(() => root.render(<Probe connectorConfig={gmailConnectorMeta} {...options} />))
  }

  function visibleLabelFields() {
    return gmailConnectorMeta.configFields
      .filter((field) => field.canonicalParamId === 'label' && current.isFieldVisible(field))
      .map((field) => field.id)
  }

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

  it.each(['members', 'admin'] as const)(
    'offers manual label names for %s Gmail setup',
    (accessMode) => {
      render({ accessMode })

      expect(visibleLabelFields()).toEqual(['label'])
      expect(current!.canonicalModes.label).toBe('advanced')
      expect(current!.canonicalGroups.get('label')?.map((field) => field.id)).toEqual(['label'])
    }
  )

  it('resolves manual names and system IDs through the existing canonical label field', () => {
    render({ accessMode: 'members' })
    act(() => current.handleFieldChange('label', ' INBOX, Engineering, , Product Updates '))

    expect(current!.resolveSourceConfig()).toMatchObject({
      label: ['INBOX', 'Engineering', 'Product Updates'],
    })
    expect(current!.resolveSourceConfig()).not.toHaveProperty('labelSelector')
  })

  it('preserves the general knowledge-base label selector and its mailbox-local IDs', () => {
    render()
    act(() => current.handleFieldChange('labelSelector', ['INBOX', 'Label_7']))

    expect(visibleLabelFields()).toEqual(['labelSelector'])
    expect(current!.canonicalModes.label).toBe('basic')
    expect(current!.resolveSourceConfig()).toMatchObject({ label: ['INBOX', 'Label_7'] })

    act(() => current.toggleCanonicalMode('label'))
    act(() => current.handleFieldChange('label', 'Engineering'))
    expect(visibleLabelFields()).toEqual(['label'])
    expect(current!.resolveSourceConfig()).toMatchObject({ label: ['Engineering'] })

    act(() => current.toggleCanonicalMode('label'))
    expect(visibleLabelFields()).toEqual(['labelSelector'])
    expect(current!.resolveSourceConfig()).toMatchObject({ label: ['INBOX', 'Label_7'] })
  })

  it.each(['members', 'admin'] as const)(
    'keeps a visible manual field when a saved %s draft selected basic mode',
    (accessMode) => {
      render({
        accessMode,
        initialCanonicalModes: { label: 'basic' },
        initialSourceConfig: { labelSelector: ['Label_7'], label: ['Engineering'] },
      })

      expect(visibleLabelFields()).toEqual(['label'])
      expect(current!.canonicalModes.label).toBe('advanced')
      expect(current!.resolveSourceConfig()).toMatchObject({ label: ['Engineering'] })
    }
  )

  it('keeps fields visible and preserves edits when switching access modes without remounting', () => {
    render({
      initialCanonicalModes: { label: 'basic' },
      initialSourceConfig: { labelSelector: ['Label_7'], label: ['Engineering'] },
    })
    expect(visibleLabelFields()).toEqual(['labelSelector'])

    render({ accessMode: 'members' })
    expect(visibleLabelFields()).toEqual(['label'])
    expect(current!.resolveSourceConfig()).toMatchObject({ label: ['Engineering'] })
    act(() => current.handleFieldChange('label', 'Engineering, Support'))

    render({ accessMode: 'workspace' })
    expect(visibleLabelFields()).toEqual(['labelSelector'])
    expect(current!.resolveSourceConfig()).toMatchObject({ label: ['Label_7'] })

    render({ accessMode: 'members' })
    expect(visibleLabelFields()).toEqual(['label'])
    expect(current!.resolveSourceConfig()).toMatchObject({ label: ['Engineering', 'Support'] })
  })

  it('does not let a populated hidden selector satisfy a required manual field', () => {
    const requiredLabels: ConnectorMeta = {
      ...gmailConnectorMeta,
      configFields: gmailConnectorMeta.configFields.map((field) => ({
        ...field,
        required: field.canonicalParamId === 'label',
      })),
    }
    render({
      connectorConfig: requiredLabels,
      accessMode: 'members',
      initialCanonicalModes: { label: 'basic' },
      initialSourceConfig: { labelSelector: ['Label_7'] },
    })

    function missingRequiredFields() {
      return requiredLabels.configFields
        .filter(
          (field) =>
            field.required && current.isFieldVisible(field) && !current.isFieldPopulated(field)
        )
        .map((field) => field.id)
    }

    expect(visibleLabelFields()).toEqual(['label'])
    expect(missingRequiredFields()).toEqual(['label'])
    expect(current!.resolveSourceConfig()).toMatchObject({ label: [] })

    act(() => current.handleFieldChange('label', '   '))
    expect(missingRequiredFields()).toEqual(['label'])

    act(() => current.handleFieldChange('label', 'Engineering'))
    expect(missingRequiredFields()).toEqual([])
    expect(current!.resolveSourceConfig()).toMatchObject({ label: ['Engineering'] })
  })

  it('hides mirrored sharing settings for members without discarding a saved central policy', () => {
    const field = googleDriveConnectorMeta.configFields.find((field) => field.id === 'openSharing')!
    render({
      connectorConfig: googleDriveConnectorMeta,
      accessMode: 'members',
      initialSourceConfig: { openSharing: 'domain' },
    })

    expect(current!.isFieldVisible(field)).toBe(false)
    expect(current!.resolveSourceConfig()).toMatchObject({ openSharing: 'domain' })

    render({ connectorConfig: googleDriveConnectorMeta, accessMode: 'admin' })
    expect(current!.isFieldVisible(field)).toBe(true)
    expect(current!.resolveSourceConfig()).toMatchObject({ openSharing: 'domain' })
  })

  it.each([googleDriveConnectorMeta, googleCalendarConnectorMeta, gmailConnectorMeta])(
    'offers directory user selection only for central $name crawls',
    (connectorConfig) => {
      const field = connectorConfig.configFields.find((field) => field.id === 'userEmails')!
      render({ connectorConfig, accessMode: 'admin' })
      expect(current.isFieldVisible(field)).toBe(true)
      act(() => current.handleFieldChange('userEmails', 'first@example.com, second@example.com'))
      expect(current.resolveSourceConfig().userEmails).toEqual([
        'first@example.com',
        'second@example.com',
      ])

      render({ connectorConfig, accessMode: 'members' })
      expect(current.isFieldVisible(field)).toBe(false)
      render({ connectorConfig, accessMode: 'workspace' })
      expect(current.isFieldVisible(field)).toBe(false)
      render({ connectorConfig, accessMode: 'admin' })
      expect(current.isFieldVisible(field)).toBe(true)
      expect(current.resolveSourceConfig().userEmails).toEqual([
        'first@example.com',
        'second@example.com',
      ])
    }
  )

  it('uses manual calendar IDs centrally without reusing a saved administrator calendar selection', () => {
    render({
      connectorConfig: googleCalendarConnectorMeta,
      accessMode: 'admin',
      initialCanonicalModes: { calendarId: 'basic' },
      initialSourceConfig: {
        calendarSelector: ['administrator@example.com'],
        calendarId: ['primary', 'shared@group.calendar.google.com'],
      },
    })
    const visibleCalendars = () =>
      googleCalendarConnectorMeta.configFields
        .filter((field) => field.canonicalParamId === 'calendarId' && current.isFieldVisible(field))
        .map((field) => field.id)
    expect(visibleCalendars()).toEqual(['calendarId'])
    expect(current.resolveSourceConfig().calendarId).toEqual([
      'primary',
      'shared@group.calendar.google.com',
    ])

    render({ connectorConfig: googleCalendarConnectorMeta, accessMode: 'members' })
    expect(visibleCalendars()).toEqual(['calendarSelector'])
    expect(current.resolveSourceConfig().calendarId).toEqual(['administrator@example.com'])
  })

  it('persists selector labels with the canonical IDs without changing provider values', () => {
    render({ connectorConfig: googleDriveConnectorMeta })
    act(() =>
      current.handleFieldChange(
        'folderSelector',
        ['folder-a'],
        [{ id: 'folder-a', label: 'Engineering' }]
      )
    )
    expect(current.resolveSourceConfig()).toMatchObject({ folderId: ['folder-a'] })
    expect(describeSearchSource(googleDriveConnectorMeta, current.resolveSourceConfig())).toBe(
      'Engineering'
    )
    act(() => current.handleFieldChange('folderSelector', ['folder-b']))
    expect(current.resolveSourceConfig()[SOURCE_LABELS_KEY]).toBeNull()
    expect(describeSearchSource(googleDriveConnectorMeta, current.resolveSourceConfig())).toBe(
      '1 folder selected'
    )
  })

  it('discards names on manual mode changes and form resets', () => {
    render({ connectorConfig: googleDriveConnectorMeta })
    act(() =>
      current.handleFieldChange(
        'folderSelector',
        ['folder-a'],
        [{ id: 'folder-a', label: 'Engineering' }]
      )
    )
    act(() => current.toggleCanonicalMode('folderId'))
    expect(current.selectionLabels).toEqual({})
    act(() => current.toggleCanonicalMode('folderId'))
    expect(describeSearchSource(googleDriveConnectorMeta, current.resolveSourceConfig())).toBe(
      '1 folder selected'
    )
    act(() =>
      current.handleFieldChange(
        'folderSelector',
        ['folder-a'],
        [{ id: 'folder-a', label: 'Engineering' }]
      )
    )
    act(() => current.setSourceConfig({}))
    expect(current.selectionLabels).toEqual({})
  })

  it('clears dependent selector labels together with their values', () => {
    const meta: ConnectorMeta = {
      ...googleDriveConnectorMeta,
      configFields: [
        { id: 'host', title: 'Host', type: 'short-input' },
        ...googleDriveConnectorMeta.configFields.map((field) =>
          field.canonicalParamId === 'folderId' ? { ...field, dependsOn: ['host'] } : field
        ),
      ],
    }
    render({ connectorConfig: meta })
    act(() => current.handleFieldChange('host', 'one.example'))
    act(() =>
      current.handleFieldChange(
        'folderSelector',
        ['folder-a'],
        [{ id: 'folder-a', label: 'Engineering' }]
      )
    )
    act(() => current.handleFieldChange('host', 'two.example'))
    expect(current.selectionLabels).toEqual({})
    expect(current.resolveSourceConfig()).toMatchObject({ folderId: [] })
  })

  it('restores OAuth draft labels only when they match the restored selection', () => {
    render({
      connectorConfig: googleDriveConnectorMeta,
      initialSourceConfig: { folderSelector: ['folder-a'] },
      initialSelectionLabels: { folderId: [{ id: 'folder-a', label: 'Engineering' }] },
    })
    expect(describeSearchSource(googleDriveConnectorMeta, current.resolveSourceConfig())).toBe(
      'Engineering'
    )
    act(() =>
      current.handleFieldChange(
        'folderSelector',
        ['folder-a'],
        [{ id: 'folder-b', label: 'Other docs' }]
      )
    )
    expect(current.resolveSourceConfig()[SOURCE_LABELS_KEY]).toBeNull()
  })
})
