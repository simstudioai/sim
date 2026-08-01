/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataDrain, DataDrainRun } from '@/lib/api/contracts/data-drains'

const {
  mockToastError,
  mockToastSuccess,
  mockUseDataDrainRuns,
  mockUseDeleteDataDrain,
  mockUseRunDataDrainNow,
  mockUseTestDataDrain,
  mockUseUpdateDataDrain,
} = vi.hoisted(() => ({
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockUseDataDrainRuns: vi.fn(),
  mockUseDeleteDataDrain: vi.fn(),
  mockUseRunDataDrainNow: vi.fn(),
  mockUseTestDataDrain: vi.fn(),
  mockUseUpdateDataDrain: vi.fn(),
}))

interface ConfirmModalProps {
  open?: boolean
  confirm?: { label?: string; onClick?: () => void }
}

vi.mock('@sim/emcn', () => ({
  Badge: ({ children }: { children?: ReactNode }) => <span data-testid='badge'>{children}</span>,
  ChipConfirmModal: ({ open, confirm }: ConfirmModalProps) =>
    open ? (
      <button type='button' data-testid='confirm-delete' onClick={() => confirm?.onClick?.()}>
        {confirm?.label}
      </button>
    ) : null,
  Label: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Switch: ({ checked, onCheckedChange }: { checked?: boolean; onCheckedChange?: () => void }) => (
    <button
      type='button'
      data-testid='enabled-toggle'
      aria-pressed={checked}
      onClick={() => onCheckedChange?.()}
    >
      toggle
    </button>
  ),
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
          data-testid={`action-${action.text}`}
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

vi.mock('@/app/workspace/[workspaceId]/settings/components/settings-empty-state', () => ({
  SettingsEmptyState: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
}))

vi.mock('@/app/workspace/[workspaceId]/components', () => ({ ResourceTile: () => <div /> }))

vi.mock('@/app/workspace/[workspaceId]/components/credential-detail', () => ({
  CredentialDetailHeading: ({ title, subtitle }: { title?: ReactNode; subtitle?: ReactNode }) => (
    <header>
      <h1>{title}</h1>
      <p data-testid='subtitle'>{subtitle}</p>
    </header>
  ),
}))

vi.mock('@/ee/data-drains/hooks/data-drains', () => ({
  useDataDrainRuns: mockUseDataDrainRuns,
  useDeleteDataDrain: mockUseDeleteDataDrain,
  useRunDataDrainNow: mockUseRunDataDrainNow,
  useTestDataDrain: mockUseTestDataDrain,
  useUpdateDataDrain: mockUseUpdateDataDrain,
}))

import { DataDrainDetail } from '@/ee/data-drains/components/data-drain-detail'

const drain = {
  id: 'drain-1',
  organizationId: 'org-1',
  name: 'Workflow logs export',
  source: 'workflow_logs',
  scheduleCadence: 'daily',
  enabled: true,
  cursor: null,
  lastRunAt: null,
  lastSuccessAt: null,
  createdBy: 'user-1',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  destinationType: 's3',
  destinationConfig: {
    bucket: 'my-logs',
    region: 'us-east-1',
    prefix: '',
    forcePathStyle: true,
  },
} as unknown as DataDrain

function makeRun(overrides: Partial<DataDrainRun> = {}): DataDrainRun {
  return {
    id: 'run-1',
    drainId: 'drain-1',
    status: 'success',
    trigger: 'cron',
    startedAt: '2026-07-24T18:00:00.000Z',
    finishedAt: '2026-07-24T18:01:00.000Z',
    rowsExported: 1204,
    bytesWritten: 512,
    cursorBefore: null,
    cursorAfter: null,
    error: null,
    locators: [],
    ...overrides,
  }
}

let container: HTMLDivElement
let root: Root
const mutateAsync = {
  update: vi.fn(),
  del: vi.fn(),
  run: vi.fn(),
  test: vi.fn(),
}

function render(node: ReactNode) {
  act(() => {
    root.render(node)
  })
}

function click(testId: string) {
  const el = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)
  if (!el) throw new Error(`missing ${testId}`)
  act(() => {
    el.click()
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mutateAsync.update.mockResolvedValue(undefined)
  mutateAsync.del.mockResolvedValue(undefined)
  mutateAsync.run.mockResolvedValue(undefined)
  mutateAsync.test.mockResolvedValue(undefined)
  mockUseUpdateDataDrain.mockReturnValue({ mutateAsync: mutateAsync.update, isPending: false })
  mockUseDeleteDataDrain.mockReturnValue({ mutateAsync: mutateAsync.del, isPending: false })
  mockUseRunDataDrainNow.mockReturnValue({ mutateAsync: mutateAsync.run, isPending: false })
  mockUseTestDataDrain.mockReturnValue({ mutateAsync: mutateAsync.test, isPending: false })
  mockUseDataDrainRuns.mockReturnValue({ data: [], isPending: false, isPlaceholderData: false })
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

describe('DataDrainDetail', () => {
  it('surfaces the metadata the list table used to show in columns', () => {
    render(<DataDrainDetail organizationId='org-1' drain={drain} onBack={vi.fn()} />)

    expect(container.textContent).toContain('Workflow logs export')
    expect(container.querySelector('[data-testid="subtitle"]')?.textContent).toBe(
      'Workflow logs → Amazon S3 · Every day'
    )
    expect(container.textContent).toContain('Every day')
    expect(container.textContent).toContain('Never')
  })

  it('renders destination config generically, including booleans and blanks', () => {
    render(<DataDrainDetail organizationId='org-1' drain={drain} onBack={vi.fn()} />)

    expect(container.textContent).toContain('Bucket')
    expect(container.textContent).toContain('my-logs')
    expect(container.textContent).toContain('Force path style')
    expect(container.textContent).not.toContain('Force Path Style')
    expect(container.textContent).toContain('Yes')
    expect(container.textContent).toContain('—')
  })

  it('labels config keys in sentence case, keeping initialisms upper', () => {
    render(
      <DataDrainDetail
        organizationId='org-1'
        drain={
          {
            ...drain,
            destinationConfig: { accessKeyId: 'AKIA', serviceAccountJson: '{}', url: 'https://x' },
          } as unknown as DataDrain
        }
        onBack={vi.fn()}
      />
    )

    expect(container.textContent).toContain('Access key ID')
    expect(container.textContent).toContain('Service account JSON')
    expect(container.textContent).toContain('URL')
  })

  it('never exposes destination credentials', () => {
    render(<DataDrainDetail organizationId='org-1' drain={drain} onBack={vi.fn()} />)
    expect(container.textContent?.toLowerCase()).not.toContain('secret')
    expect(container.textContent?.toLowerCase()).not.toContain('credential')
  })

  it('reports a sub-kilobyte run size instead of flooring it to zero', () => {
    mockUseDataDrainRuns.mockReturnValue({
      data: [makeRun({ bytesWritten: 512 })],
      isPending: false,
      isPlaceholderData: false,
    })
    render(<DataDrainDetail organizationId='org-1' drain={drain} onBack={vi.fn()} />)

    expect(container.textContent).toContain('512 Bytes')
    expect(container.textContent).not.toContain('0 Bytes')
    expect(container.textContent).toContain('1,204 rows')
  })

  it('formats a multi-gigabyte run without inflating the unit', () => {
    mockUseDataDrainRuns.mockReturnValue({
      data: [makeRun({ bytesWritten: 5 * 1024 ** 3 })],
      isPending: false,
      isPlaceholderData: false,
    })
    render(<DataDrainDetail organizationId='org-1' drain={drain} onBack={vi.fn()} />)

    expect(container.textContent).toContain('5 GB')
    expect(container.textContent).not.toContain('KB')
  })

  it('keeps Run now disabled while the drain is disabled, as the row menu did', () => {
    render(
      <DataDrainDetail
        organizationId='org-1'
        drain={{ ...drain, enabled: false }}
        onBack={vi.fn()}
      />
    )
    const runNow = container.querySelector<HTMLButtonElement>('[data-testid="action-Run now"]')
    expect(runNow?.disabled).toBe(true)
  })

  it('toggles enabled through the update mutation', async () => {
    render(<DataDrainDetail organizationId='org-1' drain={drain} onBack={vi.fn()} />)
    click('enabled-toggle')
    await act(async () => {})

    expect(mutateAsync.update).toHaveBeenCalledWith({
      organizationId: 'org-1',
      drainId: 'drain-1',
      body: { enabled: false },
    })
    expect(mockToastSuccess).toHaveBeenCalledWith('Drain disabled')
  })

  it('runs and tests the drain on demand', async () => {
    render(<DataDrainDetail organizationId='org-1' drain={drain} onBack={vi.fn()} />)

    click('action-Run now')
    await act(async () => {})
    expect(mutateAsync.run).toHaveBeenCalledWith({ organizationId: 'org-1', drainId: 'drain-1' })

    click('action-Test connection')
    await act(async () => {})
    expect(mutateAsync.test).toHaveBeenCalledWith({ organizationId: 'org-1', drainId: 'drain-1' })
  })

  it('leaves the detail only after the delete resolves', async () => {
    const onBack = vi.fn()
    render(<DataDrainDetail organizationId='org-1' drain={drain} onBack={onBack} />)

    click('action-Delete')
    click('confirm-delete')
    await act(async () => {})

    expect(mutateAsync.del).toHaveBeenCalledWith({ organizationId: 'org-1', drainId: 'drain-1' })
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('stays put and reports the failure when a delete fails', async () => {
    mutateAsync.del.mockRejectedValue(new Error('drain is locked'))
    const onBack = vi.fn()
    render(<DataDrainDetail organizationId='org-1' drain={drain} onBack={onBack} />)

    click('action-Delete')
    click('confirm-delete')
    await act(async () => {})

    expect(onBack).not.toHaveBeenCalled()
    expect(mockToastError).toHaveBeenCalledWith('drain is locked')
  })

  it('treats placeholder run data as loading', () => {
    mockUseDataDrainRuns.mockReturnValue({
      data: [makeRun()],
      isPending: false,
      isPlaceholderData: true,
    })
    render(<DataDrainDetail organizationId='org-1' drain={drain} onBack={vi.fn()} />)

    expect(container.textContent).toContain('Loading runs...')
    expect(container.textContent).not.toContain('1,204 rows')
  })
})
