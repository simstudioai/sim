/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/icons', () => ({ GmailIcon: () => null, GoogleDriveIcon: () => null }))

import {
  type UseConnectorConfigFieldsOptions,
  type UseConnectorConfigFieldsResult,
  useConnectorConfigFields,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-config-fields'
import { gmailConnectorMeta } from '@/connectors/gmail/meta'
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

  it('offers only manual label names for member Gmail setup', () => {
    render({ accessMode: 'members' })

    expect(visibleLabelFields()).toEqual(['label'])
    expect(current!.canonicalModes.label).toBe('advanced')
    expect(current!.canonicalGroups.get('label')?.map((field) => field.id)).toEqual(['label'])
  })

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

  it('keeps a visible manual field when a saved member draft selected basic mode', () => {
    render({
      accessMode: 'members',
      initialCanonicalModes: { label: 'basic' },
      initialSourceConfig: { labelSelector: ['Label_7'], label: ['Engineering'] },
    })

    expect(visibleLabelFields()).toEqual(['label'])
    expect(current!.canonicalModes.label).toBe('advanced')
    expect(current!.resolveSourceConfig()).toMatchObject({ label: ['Engineering'] })
  })

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
})
