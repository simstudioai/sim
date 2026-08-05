/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '@/lib/api/client/errors'

const {
  mockWorkspaceMutate,
  mockShareMutate,
  mockUseSubmitInterfaceForm,
  mockUseSubmitPublicInterfaceForm,
  mockUseWorkflows,
} = vi.hoisted(() => ({
  mockWorkspaceMutate: vi.fn(),
  mockShareMutate: vi.fn(),
  mockUseSubmitInterfaceForm: vi.fn(),
  mockUseSubmitPublicInterfaceForm: vi.fn(),
  mockUseWorkflows: vi.fn(() => ({ data: [{ id: 'wf-1', name: 'Triage' }], isLoading: false })),
}))

vi.mock('@/hooks/queries/interfaces', () => ({
  useSubmitInterfaceForm: mockUseSubmitInterfaceForm,
}))

vi.mock('@/hooks/queries/workflows', () => ({
  useWorkflows: mockUseWorkflows,
}))

vi.mock('@/hooks/queries/public-interfaces', () => ({
  useSubmitPublicInterfaceForm: mockUseSubmitPublicInterfaceForm,
}))

import { FormModule } from '@/components/resources/interface-view/components/module-renderer/components/form-module'
import { ResourceProvider } from '@/components/resources/resource-provider'
import type {
  FormField,
  FormFieldType,
  InterfaceLayout,
  InterfaceMode,
  InterfaceModule,
} from '@/lib/interfaces/types'
import { type ResourceGrants, type ResourceSource, shareSource, workspaceSource } from '@/resources'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** The switch measures its thumb through Radix's `useSize`; jsdom ships no observer. */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub

const WORKSPACE_ID = 'ws-1'
const INTERFACE_ID = 'if-1'
const TOKEN = 'tok-1'
const MODULE_ID = 'm-form'

const EMPTY_LAYOUT: InterfaceLayout = { version: 1, grid: { rows: 1, cols: 1 }, modules: [] }

const WORKSPACE_SOURCE: ResourceSource<'interface'> = workspaceSource({
  kind: 'interface',
  workspaceId: WORKSPACE_ID,
  resourceId: INTERFACE_ID,
})

const SHARE_SOURCE: ResourceSource<'interface'> = shareSource({
  kind: 'interface',
  token: TOKEN,
  grantId: TOKEN,
  seed: { name: 'Shared', layout: EMPTY_LAYOUT, modules: {} },
})

const GRANTS: ResourceGrants = { write: true, run: true }

/** The subset of a TanStack mutation `FormModule` reads, mutable per test. */
interface MutationState {
  mutate: typeof mockWorkspaceMutate
  isPending: boolean
  isSuccess: boolean
  isError: boolean
  error: Error | null
  reset: () => void
}

let workspaceMutation: MutationState
let shareMutation: MutationState
let container: HTMLDivElement
let root: Root
let rerender: () => void

function mutationState(mutate: typeof mockWorkspaceMutate): MutationState {
  const state: MutationState = {
    mutate,
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
    reset: () => {},
  }
  /** Mirrors TanStack's `reset()` — the status flags go back to idle. */
  state.reset = vi.fn(() => {
    state.isSuccess = false
    state.isError = false
    state.error = null
  })
  return state
}

function field(id: string, type: FormFieldType, overrides: Partial<FormField> = {}): FormField {
  return { id, name: id, label: id, type, required: false, ...overrides }
}

function formModule(
  fields: FormField[],
  config: Partial<Extract<InterfaceModule, { type: 'form' }>['config']> = {}
): Extract<InterfaceModule, { type: 'form' }> {
  return {
    id: MODULE_ID,
    type: 'form',
    placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
    config: { workflowId: 'wf-1', fields, submitLabel: 'Submit', ...config },
  }
}

interface RenderOptions {
  mode?: InterfaceMode
  canRun?: boolean
  source?: ResourceSource<'interface'>
  /** Present = this surface may author the module, exactly as the canvas decides. */
  onConfigChange?: (moduleId: string, config: InterfaceModule['config'], isValid: boolean) => void
}

function render(
  module: Extract<InterfaceModule, { type: 'form' }>,
  { mode = 'preview', canRun = true, source = WORKSPACE_SOURCE, onConfigChange }: RenderOptions = {}
) {
  rerender = () => {
    act(() => {
      root.render(
        <ResourceProvider source={source} grants={GRANTS} host='page'>
          <FormModule module={module} mode={mode} canRun={canRun} onConfigChange={onConfigChange} />
        </ResourceProvider>
      )
    })
  }
  rerender()
}

function labelFor(text: string): HTMLLabelElement {
  const found = [...container.querySelectorAll('label')].find(
    (node) => node.textContent?.replace('*', '').trim() === text
  )
  if (!found) throw new Error(`No field labeled "${text}"`)
  return found
}

/** The control the field's label points at — i.e. the one it names. */
function controlFor(text: string): HTMLElement {
  const control = document.getElementById(labelFor(text).htmlFor)
  if (!control) throw new Error(`Field "${text}" has no labelled control`)
  return control
}

function textField(text: string): HTMLInputElement | HTMLTextAreaElement {
  return controlFor(text) as HTMLInputElement | HTMLTextAreaElement
}

/** The dropdown's trigger, found by the accessible name `FormFieldControl` gives it. */
function dropdown(label: string): HTMLButtonElement {
  const trigger = container.querySelector(`[aria-label="${label}"]`)
  if (!trigger) throw new Error(`No dropdown labelled "${label}"`)
  return trigger as HTMLButtonElement
}

/** The message a control announces through `aria-describedby`, with its role. */
function messageFor(text: string): { role: string | null; text: string } | null {
  const describedBy = controlFor(text).getAttribute('aria-describedby')
  if (!describedBy) return null
  const node = document.getElementById(describedBy)
  if (!node) return null
  return { role: node.getAttribute('role'), text: node.textContent ?? '' }
}

/** The form-level alert — the one alert no control claims as its description. */
function formAlert(): string | null {
  const described = new Set(
    [...container.querySelectorAll('[aria-describedby]')].map((node) =>
      node.getAttribute('aria-describedby')
    )
  )
  const alert = [...container.querySelectorAll('[role="alert"]')].find(
    (node) => !described.has(node.id)
  )
  return alert?.textContent ?? null
}

function submitButton(): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find((node) => node.type === 'submit')
  if (!button) throw new Error('No submit button')
  return button
}

/** The authoring affordances are named, not labelled — they replace the `<label>`. */
function buttonLabeled(name: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find(
    (node) => node.getAttribute('aria-label') === name || node.textContent?.trim() === name
  )
  if (!button) throw new Error(`No button named "${name}"`)
  return button
}

function inputLabeled(name: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)
  if (!input) throw new Error(`No input named "${name}"`)
  return input
}

/** The reorderable field rows — only present while the surface may author. */
function draggableRows(): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[draggable="true"]')]
}

/**
 * Plays a full HTML5 drag from one row to another. jsdom builds no
 * `DragEvent`, so the events carry a hand-rolled `dataTransfer` — the same
 * three fields the hook actually reads.
 */
function dragRowOnto(from: number, to: number) {
  const rows = draggableRows()
  const dataTransfer = { effectAllowed: '', dropEffect: '', setData: () => {}, getData: () => '' }
  const fire = (node: HTMLElement, type: string) => {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
    act(() => {
      node.dispatchEvent(event)
    })
  }
  fire(rows[from], 'dragstart')
  fire(rows[to], 'dragover')
  fire(rows[to], 'drop')
}

function typeInto(control: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(control, value)
  act(() => {
    control.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function type(text: string, value: string) {
  const control = textField(text)
  const prototype =
    control.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  setter?.call(control, value)
  act(() => {
    control.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function submit() {
  act(() => {
    submitButton().click()
  })
}

/** Values the active source's mutation was asked to submit. */
function submittedValues(mutate: typeof mockWorkspaceMutate): Record<string, unknown> {
  return (mutate.mock.calls.at(-1)?.[0] as { values: Record<string, unknown> }).values
}

/**
 * Drives the mutation's error path the way TanStack does: the mutation is
 * already failed by the time the per-call `onError` runs.
 */
function fail(mutation: MutationState, mutate: typeof mockWorkspaceMutate, error: Error) {
  mutation.isError = true
  mutation.error = error
  act(() => {
    const options = mutate.mock.calls.at(-1)?.[1] as { onError?: (error: unknown) => void }
    options?.onError?.(error)
  })
  rerender()
}

function succeed(mutation: MutationState, mutate: typeof mockWorkspaceMutate) {
  mutation.isSuccess = true
  act(() => {
    const options = mutate.mock.calls.at(-1)?.[1] as { onSuccess?: () => void }
    options?.onSuccess?.()
  })
  rerender()
}

/** A 400 from the submit route: `{ error, details: FormSubmissionFieldError[] }`. */
function rejection(details: unknown): ApiClientError {
  return new ApiClientError({
    status: 400,
    message: 'Invalid submission',
    body: { error: 'Invalid submission', details },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  workspaceMutation = mutationState(mockWorkspaceMutate)
  shareMutation = mutationState(mockShareMutate)
  mockUseSubmitInterfaceForm.mockImplementation(() => workspaceMutation)
  mockUseSubmitPublicInterfaceForm.mockImplementation(() => shareMutation)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('FormModule — unconfigured', () => {
  it('binds its own workflow from the module while authoring', () => {
    render(formModule([field('a', 'short-text')], { workflowId: null }), {
      mode: 'edit',
      onConfigChange: vi.fn(),
    })
    expect(container.textContent).toContain('Select a workflow')
  })

  /**
   * `onConfigChange` is what the canvas withholds from a read-only member, so
   * its absence must never leave a picker the viewer cannot act on.
   */
  it('falls back to the unavailable copy without an authoring callback', () => {
    render(formModule([field('a', 'short-text')], { workflowId: null }), { mode: 'edit' })
    expect(container.textContent).toContain('This form is not available.')
    expect(container.textContent).not.toContain('Select a workflow')
  })

  it('tells a visitor the form is unavailable instead of naming the editor', () => {
    render(formModule([field('a', 'short-text')], { workflowId: null }))
    expect(container.textContent).toContain('This form is not available.')
    expect(container.textContent).not.toContain('properties panel')
  })

  it('offers to add the first field on the module while authoring', () => {
    const onConfigChange = vi.fn()
    render(formModule([]), { mode: 'edit', onConfigChange })

    const addField = buttonLabeled('Add field')
    act(() => addField.click())

    const [moduleId, config, isValid] = onConfigChange.mock.calls[0]
    expect(moduleId).toBe(MODULE_ID)
    expect((config as { fields: FormField[] }).fields).toHaveLength(1)
    expect(isValid).toBe(true)
  })

  it('offers no add-field affordance without an authoring callback', () => {
    render(formModule([]), { mode: 'edit' })
    expect(container.textContent).toContain('This form is not available.')
    expect(container.textContent).not.toContain('Add field')
  })

  it('tells a visitor a field-less form is unavailable', () => {
    render(formModule([]))
    expect(container.textContent).toContain('This form is not available.')
    expect(container.textContent).not.toContain('properties panel')
  })
})

describe('FormModule — field rendering', () => {
  const fields = [
    field('short', 'short-text', { label: 'Name' }),
    field('long', 'long-text', { label: 'Bio' }),
    field('drop', 'dropdown', { label: 'Country', options: ['Germany', 'Japan'] }),
    field('flag', 'switch', { label: 'Subscribe' }),
  ]

  it('renders one control per field type', () => {
    render(formModule(fields))

    expect(textField('Name').tagName).toBe('INPUT')
    expect(textField('Bio').tagName).toBe('TEXTAREA')
    expect(dropdown('Country').textContent).toContain('Select an option')
    expect(container.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false')
  })

  it('seeds every control from its default value', () => {
    render(
      formModule([
        field('short', 'short-text', { label: 'Name', defaultValue: 'Ada' }),
        field('long', 'long-text', { label: 'Bio', defaultValue: 'Mathematician' }),
        field('drop', 'dropdown', {
          label: 'Country',
          options: ['Germany', 'Japan'],
          defaultValue: 'Japan',
        }),
        field('flag', 'switch', { label: 'Subscribe', defaultValue: true }),
      ])
    )

    expect(textField('Name').value).toBe('Ada')
    expect(textField('Bio').value).toBe('Mathematician')
    expect(dropdown('Country').textContent).toContain('Japan')
    expect(container.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true')
  })

  it('ignores a dropdown default the builder has since removed from the options', () => {
    render(
      formModule([
        field('drop', 'dropdown', {
          label: 'Country',
          options: ['Germany'],
          defaultValue: 'Japan',
        }),
      ])
    )

    expect(dropdown('Country').textContent).toContain('Select an option')
    expect(dropdown('Country').textContent).not.toContain('Japan')
  })

  it('treats a non-boolean switch default as off', () => {
    render(formModule([field('flag', 'switch', { label: 'Subscribe', defaultValue: 'true' })]))
    expect(container.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false')
  })

  it('announces required fields and renders their hints', () => {
    render(
      formModule([
        field('short', 'short-text', { label: 'Name', required: true, hint: 'Your full name' }),
      ])
    )

    expect(textField('Name').getAttribute('aria-required')).toBe('true')
    expect(messageFor('Name')).toEqual({ role: null, text: 'Your full name' })
  })

  it('labels the submit button with the configured text', () => {
    render(formModule(fields, { submitLabel: 'Run report' }))
    expect(submitButton().textContent).toBe('Run report')
  })
})

/**
 * Authoring on the module itself. The inspector still carries every field
 * property; these cover only what the module took over — the label, the order,
 * and the field list.
 */
describe('FormModule — in-module authoring', () => {
  const fields = [field('a', 'short-text', { label: 'Email' }), field('b', 'short-text')]

  function renderAuthoring(onConfigChange = vi.fn()) {
    render(formModule(fields), { mode: 'edit', onConfigChange })
    return onConfigChange
  }

  it('renames a field in place', () => {
    const onConfigChange = renderAuthoring()

    typeInto(inputLabeled('Label for Email'), 'Work email')

    const [, config, isValid] = onConfigChange.mock.calls.at(-1) as [
      string,
      { fields: FormField[] },
      boolean,
    ]
    expect(config.fields[0].label).toBe('Work email')
    expect(isValid).toBe(true)
  })

  /** An empty label is a real violation, so the edit is emitted but not armed. */
  it('reports an emptied label as unsafe to persist', () => {
    const onConfigChange = renderAuthoring()

    typeInto(inputLabeled('Label for Email'), '')

    const [, , isValid] = onConfigChange.mock.calls.at(-1) as [string, unknown, boolean]
    expect(isValid).toBe(false)
  })

  it('removes a field from the module', () => {
    const onConfigChange = renderAuthoring()

    act(() => buttonLabeled('Remove Email').click())

    const [, config] = onConfigChange.mock.calls.at(-1) as [string, { fields: FormField[] }]
    expect(config.fields.map((f) => f.id)).toEqual(['b'])
  })

  /**
   * Reordering replaced a move-up/move-down menu with a drag, so this covers
   * the wiring end to end: the row is draggable, and a drop emits the reordered
   * field list.
   */
  it('reorders fields by dragging one row onto another', () => {
    const onConfigChange = renderAuthoring()

    const rows = draggableRows()
    expect(rows).toHaveLength(fields.length)

    dragRowOnto(0, 1)

    const [, config, isValid] = onConfigChange.mock.calls.at(-1) as [
      string,
      { fields: FormField[] },
      boolean,
    ]
    expect(config.fields.map((f) => f.id)).toEqual(['b', 'a'])
    expect(isValid).toBe(true)
  })

  it('mounts no drag affordance for a viewer who cannot write', () => {
    render(formModule(fields), { mode: 'edit' })
    expect(draggableRows()).toHaveLength(0)
  })

  /** Only the label editors stay live; the fields themselves never accept input here. */
  it('keeps the rendered controls inert while authoring', () => {
    renderAuthoring()

    const valueInputs = [...container.querySelectorAll<HTMLInputElement>('input:not([aria-label])')]
    expect(valueInputs).toHaveLength(fields.length)
    expect(valueInputs.every((input) => input.disabled)).toBe(true)
    expect(submitButton().disabled).toBe(true)
  })

  it('mounts no authoring affordances for a viewer who cannot write', () => {
    render(formModule(fields), { mode: 'edit' })
    expect(container.querySelector('input[aria-label="Label for Email"]')).toBeNull()
    expect(container.textContent).not.toContain('Add field')
  })
})

describe('FormModule — client-side validation', () => {
  const requiredName = formModule([
    field('short', 'short-text', { label: 'Name', required: true }),
    field('flag', 'switch', { label: 'Subscribe' }),
  ])

  it('refuses to submit an invalid form and marks the offending field', () => {
    render(requiredName)

    submit()

    expect(mockWorkspaceMutate).not.toHaveBeenCalled()
    expect(messageFor('Name')).toEqual({ role: 'alert', text: 'Name is required' })
  })

  it('rejects a required field holding only whitespace', () => {
    render(requiredName)

    type('Name', '   ')
    submit()

    expect(mockWorkspaceMutate).not.toHaveBeenCalled()
    expect(messageFor('Name')?.text).toBe('Name is required')
  })

  it('clears a field error as soon as the visitor edits that field', () => {
    render(requiredName)
    submit()
    expect(messageFor('Name')?.role).toBe('alert')

    type('Name', 'Ada')

    expect(messageFor('Name')).toBeNull()
  })

  it('submits every field once the form validates, defaults included', () => {
    render(requiredName)

    type('Name', 'Ada')
    submit()

    expect(mockWorkspaceMutate).toHaveBeenCalledTimes(1)
    expect(submittedValues(mockWorkspaceMutate)).toEqual({ short: 'Ada', flag: false })
  })

  it('sends a dropdown left untouched as an empty value', () => {
    render(
      formModule([field('drop', 'dropdown', { label: 'Country', options: ['Germany', 'Japan'] })])
    )

    submit()

    expect(submittedValues(mockWorkspaceMutate)).toEqual({ drop: '' })
  })

  it('rejects a required dropdown with nothing chosen', () => {
    render(
      formModule([
        field('drop', 'dropdown', { label: 'Country', options: ['Germany'], required: true }),
      ])
    )

    submit()

    expect(mockWorkspaceMutate).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Country is required')
  })

  /**
   * Every other control type spreads the `aria` bundle, so a rejected dropdown
   * that only rendered the message below itself would leave a screen-reader
   * user told the field is invalid but never told why.
   */
  it('wires a rejected dropdown to its error message and marks it invalid', () => {
    render(
      formModule([
        field('drop', 'dropdown', { label: 'Country', options: ['Germany'], required: true }),
      ])
    )

    submit()

    const trigger = dropdown('Country')
    expect(trigger.getAttribute('aria-invalid')).toBe('true')
    expect(trigger.getAttribute('aria-required')).toBe('true')

    const describedBy = trigger.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(container.querySelector(`#${describedBy}`)?.textContent).toContain('Country is required')
  })

  it('lets the visible field label point at the dropdown trigger', () => {
    render(formModule([field('drop', 'dropdown', { label: 'Country', options: ['Germany'] })]))

    const trigger = dropdown('Country')
    expect(trigger.id).toBeTruthy()
    expect(container.querySelector(`label[for="${trigger.id}"]`)?.textContent).toContain('Country')
  })
})

describe('FormModule — server-reported field errors', () => {
  const module = formModule([
    field('short', 'short-text', { label: 'Name' }),
    field('long', 'long-text', { label: 'Bio' }),
  ])

  it('shows a rejection on the field the server named', () => {
    render(module)
    submit()

    fail(
      workspaceMutation,
      mockWorkspaceMutate,
      rejection([{ fieldId: 'short', message: 'Name must be one of the available options' }])
    )

    expect(messageFor('Name')).toEqual({
      role: 'alert',
      text: 'Name must be one of the available options',
    })
    expect(formAlert()).toBeNull()
  })

  /**
   * The visitor's cached field list can be up to 30s behind the builder's, so a
   * rejection can name a field this render does not draw. It must still surface.
   */
  it('surfaces a rejection for a field this render no longer draws', () => {
    render(module)
    submit()

    fail(
      workspaceMutation,
      mockWorkspaceMutate,
      rejection([{ fieldId: 'since-renamed', message: 'Email is required' }])
    )

    expect(formAlert()).toBe('Email is required')
    expect(messageFor('Name')).toBeNull()
  })

  it('shows the rendered errors inline and the unrendered one on the form', () => {
    render(module)
    submit()

    fail(
      workspaceMutation,
      mockWorkspaceMutate,
      rejection([
        { fieldId: 'short', message: 'Name is required' },
        { fieldId: 'since-renamed', message: 'Email is required' },
      ])
    )

    expect(messageFor('Name')?.text).toBe('Name is required')
    expect(formAlert()).toBe('Email is required')
  })

  it('reports only the first message for a field named twice', () => {
    render(module)
    submit()

    fail(
      workspaceMutation,
      mockWorkspaceMutate,
      rejection([
        { fieldId: 'short', message: 'Name is required' },
        { fieldId: 'short', message: 'Name is too long' },
      ])
    )

    expect(messageFor('Name')?.text).toBe('Name is required')
  })

  it('falls back to the mutation message when the failure carries no field details', () => {
    render(module)
    submit()

    fail(
      workspaceMutation,
      mockWorkspaceMutate,
      new ApiClientError({ status: 500, message: 'Workflow is not deployed', body: null })
    )

    expect(formAlert()).toBe('Workflow is not deployed')
    expect(messageFor('Name')).toBeNull()
  })

  it('falls back to the mutation message when every detail entry is malformed', () => {
    render(module)
    submit()

    fail(workspaceMutation, mockWorkspaceMutate, rejection([{ fieldId: 7, message: null }, null]))

    expect(formAlert()).toBe('Invalid submission')
  })

  it('falls back to the mutation message for a failure that is not an API error', () => {
    render(module)
    submit()

    fail(workspaceMutation, mockWorkspaceMutate, new Error('Network request failed'))

    expect(formAlert()).toBe('Network request failed')
  })

  it('clears both the inline and the unrendered error when the visitor edits a field', () => {
    render(module)
    submit()
    fail(
      workspaceMutation,
      mockWorkspaceMutate,
      rejection([
        { fieldId: 'short', message: 'Name is required' },
        { fieldId: 'since-renamed', message: 'Email is required' },
      ])
    )

    type('Name', 'Ada')

    expect(messageFor('Name')).toBeNull()
    expect(formAlert()).toBeNull()
  })
})

describe('FormModule — run lifecycle', () => {
  const module = formModule([field('short', 'short-text', { label: 'Name' })])

  it('resets entered values once a run is accepted', () => {
    render(formModule([field('short', 'short-text', { label: 'Name', defaultValue: 'Ada' })]))

    type('Name', 'Grace')
    submit()
    succeed(workspaceMutation, mockWorkspaceMutate)

    expect(textField('Name').value).toBe('Ada')
    expect(container.textContent).toContain('Submitted')
  })

  it('disables the controls and swaps the label while the run is in flight', () => {
    render(module)

    workspaceMutation.isPending = true
    rerender()

    expect(textField('Name').disabled).toBe(true)
    expect(submitButton().disabled).toBe(true)
    expect(submitButton().textContent).toBe('Submitting…')
  })

  it('disables submitting in edit mode', () => {
    render(module, { mode: 'edit' })

    submit()

    expect(submitButton().disabled).toBe(true)
    expect(mockWorkspaceMutate).not.toHaveBeenCalled()
  })

  it('disables submitting for a viewer without run access', () => {
    render(module, { canRun: false })

    submit()

    expect(submitButton().disabled).toBe(true)
    expect(mockWorkspaceMutate).not.toHaveBeenCalled()
    expect(container.textContent).toContain('You do not have access to submit this form.')
  })
})

/**
 * The same module mounted against a share source. `useModuleFormSubmit` builds
 * both mutations on every render, so these pin that only the source's own ever
 * fires — and that the public route's rejections render identically.
 */
describe('FormModule — source routing', () => {
  const module = formModule([field('short', 'short-text', { label: 'Name' })])

  it('submits through the workspace route and never the token one', () => {
    render(module)

    type('Name', 'Ada')
    submit()

    expect(mockWorkspaceMutate).toHaveBeenCalledTimes(1)
    expect(mockWorkspaceMutate.mock.calls[0][0]).toEqual({
      interfaceId: INTERFACE_ID,
      moduleId: MODULE_ID,
      values: { short: 'Ada' },
    })
    expect(mockShareMutate).not.toHaveBeenCalled()
    expect(mockUseSubmitInterfaceForm).toHaveBeenCalledWith(WORKSPACE_ID)
    /** The idle mutation is still built, but with nothing to address. */
    expect(mockUseSubmitPublicInterfaceForm).toHaveBeenCalledWith('')
  })

  it('submits through the token route and never the workspace one', () => {
    render(module, { source: SHARE_SOURCE })

    type('Name', 'Ada')
    submit()

    expect(mockShareMutate).toHaveBeenCalledTimes(1)
    expect(mockShareMutate.mock.calls[0][0]).toEqual({
      moduleId: MODULE_ID,
      values: { short: 'Ada' },
    })
    expect(mockWorkspaceMutate).not.toHaveBeenCalled()
    expect(mockUseSubmitPublicInterfaceForm).toHaveBeenCalledWith(TOKEN)
    expect(mockUseSubmitInterfaceForm).toHaveBeenCalledWith('')
  })

  it('renders the token route rejections exactly like the workspace ones', () => {
    render(module, { source: SHARE_SOURCE })
    submit()

    fail(
      shareMutation,
      mockShareMutate,
      rejection([
        { fieldId: 'short', message: 'Name is required' },
        { fieldId: 'since-renamed', message: 'Email is required' },
      ])
    )

    expect(messageFor('Name')?.text).toBe('Name is required')
    expect(formAlert()).toBe('Email is required')
  })

  it('reads its status from the source mutation only', () => {
    render(module, { source: SHARE_SOURCE })

    workspaceMutation.isPending = true
    rerender()
    expect(submitButton().textContent).toBe('Submit')

    shareMutation.isPending = true
    rerender()
    expect(submitButton().textContent).toBe('Submitting…')
  })
})
