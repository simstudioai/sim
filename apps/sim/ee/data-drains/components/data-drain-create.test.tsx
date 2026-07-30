/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DESTINATION_TYPES } from '@/lib/data-drains/types'

const { mockToastError, mockToastSuccess, mockUseCreateDataDrain, mockGuardBack } = vi.hoisted(
  () => ({
    mockToastError: vi.fn(),
    mockToastSuccess: vi.fn(),
    mockUseCreateDataDrain: vi.fn(),
    mockGuardBack: vi.fn((onLeave: () => void) => onLeave()),
  })
)

interface SelectProps {
  value?: string
  onChange?: (value: string) => void
  options?: { value: string; label: string }[]
  'aria-label'?: string
}

vi.mock('@sim/emcn', () => ({
  // A real <label for> so the wiring assertions below mean something.
  Label: ({ htmlFor, children }: { htmlFor?: string; children?: ReactNode }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
  Info: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  ChipInput: ({
    id,
    value,
    onChange,
  }: {
    id?: string
    value?: string
    onChange?: (event: { target: { value: string } }) => void
  }) => (
    <input id={id} value={value ?? ''} onChange={(event) => onChange?.({ target: event.target })} />
  ),
  ChipTextarea: ({
    id,
    value,
    onChange,
  }: {
    id?: string
    value?: string
    onChange?: (event: { target: { value: string } }) => void
  }) => (
    <textarea
      id={id}
      value={value ?? ''}
      onChange={(event) => onChange?.({ target: event.target })}
    />
  ),
  // Real SecretInput calls onChange with the plain value, not an event.
  SecretInput: ({
    id,
    value,
    onChange,
  }: {
    id?: string
    value?: string
    onChange?: (next: string) => void
  }) => (
    <input
      id={id}
      type='password'
      value={value ?? ''}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
  ChipSelect: ({ value, onChange, options, ...rest }: SelectProps) => (
    <select
      aria-label={rest['aria-label']}
      value={value ?? ''}
      onChange={(event) => onChange?.(event.target.value)}
    >
      {(options ?? []).map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  Switch: ({ id }: { id?: string }) => <input id={id} type='checkbox' />,
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  toast: { error: mockToastError, success: mockToastSuccess },
}))

vi.mock('@sim/emcn/icons', () => ({ ArrowLeft: () => <svg />, Database: () => <svg /> }))

interface SettingsAction {
  text: string
  disabled?: boolean
  onSelect?: () => void
}

vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-panel', () => ({
  SettingsPanel: ({ actions, children }: { actions?: SettingsAction[]; children?: ReactNode }) => (
    <div>
      {actions?.map((action) => (
        <button
          type='button'
          key={action.text}
          data-testid='primary-action'
          disabled={action.disabled}
          onClick={() => action.onSelect?.()}
        >
          {action.text}
        </button>
      ))}
      {children}
    </div>
  ),
}))

vi.mock(
  '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section',
  () => ({
    SettingsSection: ({ label, children }: { label: string; children?: ReactNode }) => (
      <section>
        <h2>{label}</h2>
        {children}
      </section>
    ),
  })
)

vi.mock('@/app/workspace/[workspaceId]/components', () => ({ ResourceTile: () => <div /> }))

vi.mock('@/app/workspace/[workspaceId]/components/credential-detail', () => ({
  CredentialDetailHeading: ({ title }: { title?: ReactNode }) => <h1>{title}</h1>,
  UnsavedChangesModal: () => null,
}))

vi.mock('@/app/workspace/[workspaceId]/settings/hooks/use-settings-unsaved-guard', () => ({
  useSettingsUnsavedGuard: () => ({
    showUnsavedModal: false,
    setShowUnsavedModal: vi.fn(),
    guardBack: mockGuardBack,
    confirmDiscard: vi.fn(),
  }),
}))

vi.mock('@/ee/data-drains/hooks/data-drains', () => ({
  useCreateDataDrain: mockUseCreateDataDrain,
}))

import { DataDrainCreate } from '@/ee/data-drains/components/data-drain-create'
import { DESTINATION_FORM_REGISTRY } from '@/ee/data-drains/destinations/registry'

let container: HTMLDivElement
let root: Root
const createMutate = vi.fn()

function render(node: ReactNode) {
  act(() => {
    root.render(node)
  })
}

function primaryAction() {
  const el = container.querySelector<HTMLButtonElement>('[data-testid="primary-action"]')
  if (!el) throw new Error('missing primary action')
  return el
}

function typeInto(selector: string, value: string) {
  const el = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)
  if (!el) throw new Error(`missing ${selector}`)
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      'value'
    )?.set
    setter?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGuardBack.mockImplementation((onLeave: () => void) => onLeave())
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  createMutate.mockResolvedValue({ id: 'drain-new' })
  mockUseCreateDataDrain.mockReturnValue({
    mutateAsync: createMutate,
    isPending: false,
    error: null,
  })
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

describe('DataDrainCreate', () => {
  it('keeps Create disabled until the name and destination are complete', () => {
    render(<DataDrainCreate organizationId='org-1' onBack={vi.fn()} onCreated={vi.fn()} />)
    expect(primaryAction().disabled).toBe(true)

    typeInto('#data-drain-name', 'Workflow logs export')
    expect(primaryAction().disabled).toBe(true)

    typeInto('#drain-s3-bucket', 'my-logs-bucket')
    typeInto('#drain-s3-access-key-id', 'AKIA')
    typeInto('#drain-s3-secret-access-key', 'secret')
    expect(primaryAction().disabled).toBe(false)
  })

  it('submits the destination branch and hands the new id back', async () => {
    const onCreated = vi.fn()
    render(<DataDrainCreate organizationId='org-1' onBack={vi.fn()} onCreated={onCreated} />)

    typeInto('#data-drain-name', '  Workflow logs export  ')
    typeInto('#drain-s3-bucket', 'my-logs-bucket')
    typeInto('#drain-s3-access-key-id', 'AKIA')
    typeInto('#drain-s3-secret-access-key', 'secret')
    act(() => {
      primaryAction().click()
    })
    await act(async () => {})

    expect(createMutate).toHaveBeenCalledTimes(1)
    const body = createMutate.mock.calls[0][0].body
    expect(body.name).toBe('Workflow logs export')
    expect(body.source).toBe('workflow_logs')
    expect(body.scheduleCadence).toBe('daily')
    expect(body.destinationType).toBe('s3')
    expect(body.destinationConfig.bucket).toBe('my-logs-bucket')
    expect(body.destinationCredentials.accessKeyId).toBe('AKIA')
    expect(mockToastSuccess).toHaveBeenCalledWith('Drain created')
    expect(onCreated).toHaveBeenCalledWith('drain-new')
  })

  it('announces a failed create instead of only rendering it below the fold', async () => {
    createMutate.mockRejectedValue(new Error('bucket name is invalid'))
    const onCreated = vi.fn()
    render(<DataDrainCreate organizationId='org-1' onBack={vi.fn()} onCreated={onCreated} />)

    typeInto('#data-drain-name', 'Workflow logs export')
    typeInto('#drain-s3-bucket', 'nope')
    typeInto('#drain-s3-access-key-id', 'AKIA')
    typeInto('#drain-s3-secret-access-key', 'secret')
    act(() => {
      primaryAction().click()
    })
    await act(async () => {})

    expect(mockToastError).toHaveBeenCalledWith("Couldn't create drain", {
      description: 'bucket name is invalid',
    })
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('swaps the destination fields when the type changes', () => {
    render(<DataDrainCreate organizationId='org-1' onBack={vi.fn()} onCreated={vi.fn()} />)
    expect(container.querySelector('#drain-s3-bucket')).not.toBeNull()

    const typeSelect = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Destination type"]'
    )
    if (!typeSelect) throw new Error('missing destination select')
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set as (
        v: string
      ) => void
      setter.call(typeSelect, 'datadog')
      typeSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(container.querySelector('#drain-s3-bucket')).toBeNull()
    expect(container.querySelector('#drain-datadog-api-key')).not.toBeNull()
  })

  it('names every select for assistive tech', () => {
    render(<DataDrainCreate organizationId='org-1' onBack={vi.fn()} onCreated={vi.fn()} />)
    const labels = Array.from(container.querySelectorAll('select')).map((el) =>
      el.getAttribute('aria-label')
    )
    expect(labels).toEqual(['Source', 'Cadence', 'Destination type'])
  })
})

describe('destination form registry', () => {
  it('wires every labelled field to its control across all destinations', () => {
    for (const destination of DESTINATION_TYPES) {
      const spec = DESTINATION_FORM_REGISTRY[destination]
      render(<spec.FormFields state={spec.initialState} setState={vi.fn()} />)

      const labelled = Array.from(container.querySelectorAll('label[for]'))
      for (const label of labelled) {
        const id = label.getAttribute('for') as string
        expect(
          container.querySelector(`#${id}`),
          `${destination}: label "${label.textContent}" points at missing #${id}`
        ).not.toBeNull()
      }

      const controls = container.querySelectorAll('input, textarea')
      // Every text-ish control is reachable by its label, so none announces unnamed.
      expect(controls.length, `${destination} renders no controls`).toBeGreaterThan(0)
      expect(labelled.length, `${destination} has unlabelled controls`).toBe(controls.length)
    }
  })
})
