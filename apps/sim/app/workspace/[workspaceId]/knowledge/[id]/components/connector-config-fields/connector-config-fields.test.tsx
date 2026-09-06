/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectorConfigFields } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-config-fields/connector-config-fields'
import {
  type ConfigFieldValue,
  useConnectorConfigFields,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-config-fields'
import { gmailConnectorMeta } from '@/connectors/gmail/meta'

vi.mock('@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-selector-field', () => ({
  ConnectorSelectorField: ({ value }: { value: ConfigFieldValue }) => (
    <span data-testid='selector-value'>{Array.isArray(value) ? value.join(',') : value}</span>
  ),
}))

const CONNECTOR = {
  ...gmailConnectorMeta,
  configFields: gmailConnectorMeta.configFields.filter(
    (field) => field.canonicalParamId === 'label'
  ),
}

interface HarnessProps {
  disabled?: boolean
}

function Harness({ disabled = false }: HarnessProps) {
  const config = useConnectorConfigFields({
    connectorConfig: CONNECTOR,
    initialSourceConfig: { labelSelector: ['INBOX', 'IMPORTANT'], label: ['STARRED'] },
  })
  return (
    <ConnectorConfigFields
      connectorConfig={CONNECTOR}
      sourceConfig={config.sourceConfig}
      credentialId={null}
      canonicalGroups={config.canonicalGroups}
      canonicalModes={config.canonicalModes}
      isFieldVisible={config.isFieldVisible}
      onFieldChange={config.handleFieldChange}
      onToggleCanonicalMode={config.toggleCanonicalMode}
      disabled={disabled}
    />
  )
}

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.useFakeTimers()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

function radio(label: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(
    `input[type="radio"][aria-label="${label}"]`
  )
  if (!input) throw new Error(`Missing mode option: ${label}`)
  return input
}

describe('connector input mode switch', () => {
  it("preserves each mode's stored values when switching to manual input and back", () => {
    act(() => root.render(<Harness />))
    expect(radio('Selector').checked).toBe(true)

    act(() => radio('Manual input').click())
    expect(radio('Manual input').checked).toBe(true)
    expect(container.querySelector<HTMLInputElement>('input:not([type="radio"])')?.value).toBe(
      'STARRED'
    )

    act(() => radio('Manual input').click())
    expect(radio('Manual input').checked).toBe(true)

    act(() => radio('Selector').click())
    expect(radio('Selector').checked).toBe(true)
    expect(container.querySelector('[data-testid="selector-value"]')?.textContent).toBe(
      'INBOX,IMPORTANT'
    )
  })

  it('keeps the switch outside the field label and ignores clicks on the title', () => {
    act(() => root.render(<Harness />))
    expect(container.querySelector('[role="radiogroup"]')?.closest('label')).toBeNull()
    act(() => container.querySelector('label')?.click())
    expect(radio('Selector').checked).toBe(true)
  })

  it('prevents mode changes while submission disables the fields', () => {
    act(() => root.render(<Harness disabled />))
    expect(radio('Selector').disabled).toBe(true)
    expect(radio('Manual input').disabled).toBe(true)
    act(() => radio('Manual input').click())
    expect(radio('Selector').checked).toBe(true)
  })
})
