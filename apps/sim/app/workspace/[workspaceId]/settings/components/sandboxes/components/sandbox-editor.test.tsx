/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Sandbox } from '@/lib/api/contracts/sandboxes'
import type { SandboxDraft } from '@/app/workspace/[workspaceId]/settings/components/sandboxes/utils'

interface MockChipSelectProps {
  align?: string
  disabled?: boolean
  displayLabel?: ReactNode
  dropdownWidth?: string
  fullWidth?: boolean
  groups?: Array<{
    section?: string
    items: Array<{ label: string; value: string }>
  }>
  multiSelect?: boolean
  multiSelectValues?: string[]
  onMultiSelectChange?: (values: string[]) => void
  placeholder?: string
  searchable?: boolean
  searchPlaceholder?: string
  showAllOption?: boolean
  stayBelow?: boolean
}

const { recordChipSelectProps } = vi.hoisted(() => ({
  recordChipSelectProps: vi.fn<(props: MockChipSelectProps) => void>(),
}))

vi.mock('@sim/emcn', () => ({
  Chip: ({ children }: { children: ReactNode }) => <button type='button'>{children}</button>,
  ChipDropdown: () => null,
  ChipInput: () => null,
  ChipSelect: (props: MockChipSelectProps) => {
    recordChipSelectProps(props)
    return null
  },
  ChipTextarea: () => null,
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}))

vi.mock('@/app/workspace/[workspaceId]/settings/components/row-actions-menu', () => ({
  RowActionsMenu: ({
    actions,
  }: {
    actions: Array<{ label: string; disabled?: boolean; onSelect: () => void }>
  }) => (
    <div>
      {actions.map((action) => (
        <button
          key={action.label}
          type='button'
          disabled={action.disabled}
          onClick={action.onSelect}
        >
          {action.label}
        </button>
      ))}
    </div>
  ),
}))

import {
  SandboxEditor,
  SandboxStatus,
} from '@/app/workspace/[workspaceId]/settings/components/sandboxes/components/sandbox-editor'

const FAILED_SANDBOX: Sandbox = {
  id: 'sandbox-1',
  name: 'BigQuery',
  language: 'python',
  dependencies: ['requests'],
  systemPackages: ['jq'],
  cliTools: ['google-cloud-cli@577.0.0-r1'],
  buildStatus: 'failed',
  errorCode: 'install_failed',
  errorMessage: 'Dependency install failed',
  errorDetail: null,
  builtAt: null,
  createdAt: '2026-08-03T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z',
}

const EMPTY_DRAFT: SandboxDraft = {
  name: 'CLI sandbox',
  language: 'python',
  dependencies: '',
  systemPackages: '',
  cliTools: [],
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.appendChild(container)
  act(() => {
    root = createRoot(container)
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function renderStatus(props: {
  onRetry?: () => void
  retrying?: boolean
  retryDisabled?: boolean
}): void {
  act(() => {
    root.render(<SandboxStatus sandbox={FAILED_SANDBOX} strategy='prebuilt' {...props} />)
  })
}

function retryButton(): HTMLButtonElement | null {
  return (
    Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.startsWith('Retry')
    ) ?? null
  )
}

function renderEditor(
  onChange: (draft: SandboxDraft) => void = vi.fn(),
  draft: SandboxDraft = EMPTY_DRAFT
): void {
  act(() => {
    root.render(
      <SandboxEditor
        draft={draft}
        onChange={onChange}
        dependencyIssues={[]}
        systemPackageIssues={[]}
      />
    )
  })
}

function latestChipSelectProps(): MockChipSelectProps {
  const props = recordChipSelectProps.mock.calls.at(-1)?.[0]
  expect(props).toBeDefined()
  return props ?? {}
}

describe('SandboxEditor managed CLI tools', () => {
  it('uses the standard searchable, trigger-width multi-select', () => {
    renderEditor()

    const props = latestChipSelectProps()
    expect(props).toMatchObject({
      align: 'start',
      dropdownWidth: 'trigger',
      fullWidth: true,
      multiSelect: true,
      multiSelectValues: [],
      placeholder: 'Select managed CLI tools',
      searchable: true,
      searchPlaceholder: 'Search managed CLI tools...',
      showAllOption: false,
      stayBelow: true,
    })
    expect(props.groups?.map((group) => group.section)).toContain('Cloud')
    expect(props.groups?.flatMap((group) => group.items)).toContainEqual(
      expect.objectContaining({
        label: 'Google Cloud CLI',
        value: 'google-cloud-cli@577.0.0-r1',
      })
    )
  })

  it('renders managed CLI tools before system packages', () => {
    renderEditor()

    const content = container.textContent ?? ''
    expect(content.indexOf('Managed CLI tools')).toBeLessThan(content.indexOf('System packages'))
  })

  it('writes selected managed CLI tools into the draft', () => {
    const onChange = vi.fn<(draft: SandboxDraft) => void>()
    renderEditor(onChange)

    act(() => {
      latestChipSelectProps().onMultiSelectChange?.(['google-cloud-cli@577.0.0-r1'])
    })

    expect(onChange).toHaveBeenCalledWith({
      ...EMPTY_DRAFT,
      cliTools: ['google-cloud-cli@577.0.0-r1'],
    })
  })
})

describe('SandboxStatus build retry', () => {
  it('shows an enabled retry action for a failed saved build', () => {
    renderStatus({ onRetry: vi.fn() })

    expect(retryButton()?.textContent).toBe('Retry build')
    expect(retryButton()?.disabled).toBe(false)
  })

  it('keeps retry visible but disabled while dirty or saving', () => {
    renderStatus({ onRetry: vi.fn(), retryDisabled: true })
    expect(retryButton()?.textContent).toBe('Retry build')
    expect(retryButton()?.disabled).toBe(true)

    renderStatus({ onRetry: vi.fn(), retrying: true })
    expect(retryButton()?.textContent).toBe('Retrying...')
    expect(retryButton()?.disabled).toBe(true)
  })

  it('hides retry when the viewer lacks mutation permission', () => {
    renderStatus({})

    expect(retryButton()).toBeNull()
  })
})
