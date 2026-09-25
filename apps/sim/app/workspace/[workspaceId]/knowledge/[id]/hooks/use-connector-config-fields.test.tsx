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
  JiraIcon: () => null,
  ConfluenceIcon: () => null,
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
