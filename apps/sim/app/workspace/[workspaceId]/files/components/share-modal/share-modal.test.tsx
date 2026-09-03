/**
 * @vitest-environment jsdom
 */
import {
  act,
  Children,
  type ComponentType,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

import type {
  ShareAuthType,
  ShareRecord,
  UpsertFileShareBody,
} from '@/lib/api/contracts/public-shares'

interface MockMutationVariables extends UpsertFileShareBody {
  workspaceId: string
  fileId: string
}

interface MockMutationCallbacks {
  onSuccess?: () => void
}

interface MockButtonGroupItemProps {
  value: string
  children: ReactNode
  selectedValue?: string
  onSelect?: (value: string) => void
  disabled?: boolean
}

interface MockFooterAction {
  label: ReactNode
  onClick: () => void
  disabled?: boolean
  variant?: 'primary' | 'destructive'
}

type MockFooterSlot = MockFooterAction | { custom: ReactNode }

const {
  fileShareQueryState,
  fileShareState,
  mockCopy,
  mockGenerateShortId,
  mockMutate,
  mockToastSuccess,
  mutationState,
  permissionConfigState,
} = vi.hoisted(() => ({
  fileShareQueryState: { isFetchedAfterMount: true, isError: false },
  fileShareState: { current: null as ShareRecord | null },
  mockCopy: vi.fn(async () => true),
  mockGenerateShortId: vi.fn(() => 'pending-token-1234567890'),
  mockMutate: vi.fn(),
  mockToastSuccess: vi.fn(),
  mutationState: { isPending: false },
  permissionConfigState: {
    current: {
      allowedFileShareAuthTypes: null as ShareAuthType[] | null,
      disablePublicFileSharing: false,
    },
  },
}))

vi.mock('@sim/utils/id', () => ({
  generateShortId: mockGenerateShortId,
}))

vi.mock('@sim/emcn/icons', () => ({
  Check: () => <svg data-testid='check-icon' />,
  Link: () => <svg data-testid='link-icon' />,
  Send: () => <svg data-testid='send-icon' />,
}))

vi.mock('@sim/emcn', () => ({
  toast: { success: mockToastSuccess },
  ButtonGroup: ({
    children,
    value,
    onValueChange,
    disabled,
    'aria-label': ariaLabel,
  }: {
    children: ReactNode
    value: string
    onValueChange: (value: string) => void
    disabled?: boolean
    'aria-label'?: string
  }) => (
    <div role='radiogroup' aria-label={ariaLabel}>
      {Children.map(children, (child) =>
        isValidElement<MockButtonGroupItemProps>(child)
          ? cloneElement(child as ReactElement<MockButtonGroupItemProps>, {
              selectedValue: value,
              onSelect: onValueChange,
              disabled,
            })
          : child
      )}
    </div>
  ),
  ButtonGroupItem: ({
    value,
    children,
    selectedValue,
    onSelect,
    disabled,
  }: MockButtonGroupItemProps) => (
    <button
      type='button'
      role='radio'
      aria-checked={selectedValue === value}
      disabled={disabled}
      onClick={() => !disabled && onSelect?.(value)}
    >
      {children}
    </button>
  ),
  Chip: ({
    children,
    leftIcon: LeftIcon,
    onClick,
    disabled,
  }: {
    children: ReactNode
    leftIcon?: ComponentType<{ className?: string }>
    onClick?: () => void
    disabled?: boolean
  }) => (
    <button type='button' onClick={onClick} disabled={disabled}>
      {LeftIcon ? <LeftIcon /> : null}
      {children}
    </button>
  ),
  ChipModal: ({
    open,
    children,
    dismissDisabled,
    className,
  }: {
    open: boolean
    children: ReactNode
    dismissDisabled?: boolean
    className?: string
  }) =>
    open ? (
      <div role='dialog' data-dismiss-disabled={dismissDisabled || undefined} className={className}>
        {children}
      </div>
    ) : null,
  ChipConfirmModal: ({
    open,
    onOpenChange,
    title,
    text,
    confirm,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: ReactNode
    text?: ReactNode
    confirm: MockFooterAction & { pending?: boolean; pendingLabel?: string }
  }) =>
    open ? (
      <section role='alertdialog'>
        <h2>{title}</h2>
        {text ? <p>{text}</p> : null}
        <button type='button' onClick={() => onOpenChange(false)} disabled={confirm.pending}>
          Cancel
        </button>
        <button type='button' onClick={confirm.onClick} disabled={confirm.pending}>
          {confirm.pending ? (confirm.pendingLabel ?? confirm.label) : confirm.label}
        </button>
      </section>
    ) : null,
  ChipModalHeader: ({ children, onClose }: { children: ReactNode; onClose: () => void }) => (
    <header>
      {children}
      <button type='button' onClick={onClose}>
        Close
      </button>
    </header>
  ),
  ChipModalBody: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-testid='modal-body' className={className}>
      {children}
    </div>
  ),
  ChipModalField: ({
    type,
    title,
    children,
    value,
    onChange,
    hint,
    disabled,
  }: {
    type: string
    title: string
    children?: ReactNode
    value?: string[]
    onChange?: (value: string[]) => void
    hint?: ReactNode
    disabled?: boolean
  }) => (
    <section>
      <span>{title}</span>
      {type === 'emails' ? (
        <input
          aria-label={title}
          value={value?.join(',') ?? ''}
          onChange={(event) => onChange?.(event.target.value.split(',').filter(Boolean))}
          disabled={disabled}
        />
      ) : (
        children
      )}
      {hint ? <p>{hint}</p> : null}
    </section>
  ),
  ChipModalFooter: ({
    onCancel,
    primaryAction,
    secondaryActions,
  }: {
    onCancel: () => void
    primaryAction: MockFooterAction
    secondaryActions?: MockFooterSlot[]
  }) => (
    <footer>
      <div>
        {secondaryActions?.map((action, index) =>
          'custom' in action ? (
            <span key={index}>{action.custom}</span>
          ) : (
            <button key={index} type='button' onClick={action.onClick} disabled={action.disabled}>
              {action.label}
            </button>
          )
        )}
      </div>
      <button type='button' onClick={onCancel}>
        Cancel
      </button>
      <button
        type='button'
        onClick={primaryAction.onClick}
        disabled={primaryAction.disabled}
        data-variant={primaryAction.variant ?? 'primary'}
      >
        {primaryAction.label}
      </button>
    </footer>
  ),
  useCopyToClipboard: () => ({ copied: false, copy: mockCopy }),
}))

vi.mock('@/components/ui', () => ({
  GeneratedPasswordInput: ({
    value,
    onChange,
    placeholder,
    disabled,
  }: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    disabled?: boolean
  }) => (
    <input
      aria-label='Password'
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
    />
  ),
}))

/** SSO is a deployment feature, read through the deployment shape at render time. */
beforeAll(() => setEnvFlags({ isSsoEnabled: true }))
afterAll(resetEnvFlagsMock)
vi.mock('@/lib/messaging/email/validation', () => ({
  validateAllowlistEntry: () => null,
}))
vi.mock('@/hooks/use-permission-config', () => ({
  usePermissionConfig: () => ({
    config: permissionConfigState.current,
  }),
}))
vi.mock('@/hooks/queries/public-shares', () => ({
  useFileShare: () => ({ data: fileShareState.current, ...fileShareQueryState }),
  useUpsertFileShare: () => ({
    mutate: mockMutate,
    isPending: mutationState.isPending,
  }),
}))

import { ShareModal } from '@/app/workspace/[workspaceId]/files/components/share-modal/share-modal'

const SHARE_URL = 'https://sim.example.com/f/persisted-token'

function createShare(overrides: Partial<ShareRecord> = {}): ShareRecord {
  return {
    id: 'share-1',
    token: 'persisted-token',
    url: SHARE_URL,
    isActive: true,
    resourceType: 'file',
    resourceId: 'file-1',
    authType: 'public',
    hasPassword: false,
    allowedEmails: [],
    ...overrides,
  }
}

let container: HTMLDivElement
let onOpenChange: ReturnType<typeof vi.fn<(open: boolean) => void>>
let root: Root

async function renderModal(initialShare: ShareRecord | null = null) {
  await act(async () => {
    root.render(
      <ShareModal
        open
        onOpenChange={onOpenChange}
        workspaceId='workspace-1'
        fileId='file-1'
        fileName='report.pdf'
        initialShare={initialShare}
      />
    )
  })
}

function button(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === label
  )
  if (!match) throw new Error(`No button labelled "${label}"`)
  return match
}

function queryButton(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === label
  )
}

async function click(label: string) {
  await act(async () => button(label).click())
}

async function clickConfirmation(label: string) {
  const dialog = container.querySelector<HTMLElement>('[role="alertdialog"]')
  const match = [...(dialog?.querySelectorAll('button') ?? [])].find(
    (candidate) => candidate.textContent === label
  )
  if (!match) throw new Error(`No confirmation button labelled "${label}"`)
  await act(async () => match.click())
}

async function changePassword(value: string) {
  const input = container.querySelector<HTMLInputElement>('[aria-label="Password"]')
  if (!input) throw new Error('Password input was not rendered')
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!valueSetter) throw new Error('Password input has no value setter')
  await act(async () => {
    valueSetter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function changeAllowedEmails(value: string) {
  const input = container.querySelector<HTMLInputElement>('[aria-label="Allowed emails"]')
  if (!input) throw new Error('Allowed emails input was not rendered')
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!valueSetter) throw new Error('Allowed emails input has no value setter')
  await act(async () => {
    valueSetter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('ShareModal', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    onOpenChange = vi.fn()
    fileShareState.current = null
    fileShareQueryState.isFetchedAfterMount = true
    fileShareQueryState.isError = false
    mutationState.isPending = false
    permissionConfigState.current = {
      allowedFileShareAuthTypes: null,
      disablePublicFileSharing: false,
    }
    mockMutate.mockImplementation(
      (variables: MockMutationVariables, callbacks?: MockMutationCallbacks) => {
        const existing = fileShareState.current
        const authType = variables.authType ?? existing?.authType ?? 'public'
        fileShareState.current = {
          id: existing?.id ?? 'share-1',
          token: existing?.token ?? 'persisted-token',
          url: existing?.url ?? SHARE_URL,
          isActive: variables.isActive,
          resourceType: 'file',
          resourceId: 'file-1',
          authType,
          hasPassword: Boolean(variables.password) || existing?.hasPassword === true,
          allowedEmails: variables.allowedEmails ?? existing?.allowedEmails ?? [],
        }
        callbacks?.onSuccess?.()
      }
    )
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  it('shares without closing, then exposes the durable link and unshare action', async () => {
    await renderModal()

    expect(container.querySelector('[data-testid="modal-body"]')).not.toHaveClass('h-[280px]')
    expect(container.querySelector('[data-testid="modal-body"]')).not.toHaveClass('flex-none')
    expect(button('Public')).toHaveAttribute('aria-checked', 'true')
    expect(queryButton('Copy link')).toBeUndefined()
    expect(button('Share')).toBeEnabled()
    expect(button('Share')).toHaveAttribute('data-variant', 'primary')

    await click('Share')

    expect(mockMutate).toHaveBeenLastCalledWith(
      {
        workspaceId: 'workspace-1',
        fileId: 'file-1',
        token: 'pending-token-1234567890',
        isActive: true,
        authType: 'public',
      },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    )
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(mockToastSuccess).toHaveBeenLastCalledWith('File shared')

    await renderModal()

    expect(button('Unshare')).toBeEnabled()
    expect(button('Unshare')).toHaveAttribute('data-variant', 'destructive')
    expect(button('Copy link').querySelector('[data-testid="link-icon"]')).not.toBeNull()

    await click('Copy link')
    expect(mockCopy).toHaveBeenCalledWith(SHARE_URL)

    mockMutate.mockClear()
    await click('Unshare')
    expect(mockMutate).not.toHaveBeenCalled()
    expect(button('Unsharing...')).toHaveAttribute('data-variant', 'destructive')
    const confirmDialog = container.querySelector<HTMLElement>('[role="alertdialog"]')
    expect(confirmDialog).not.toBeNull()
    expect(confirmDialog).toHaveTextContent('Unshare file?')

    await clickConfirmation('Unshare')

    expect(mockMutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ isActive: false }),
      expect.objectContaining({ onSuccess: expect.any(Function) })
    )
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(mockToastSuccess).toHaveBeenLastCalledWith('File unshared')

    await renderModal()
    expect(button('Share')).toBeEnabled()
    expect(queryButton('Copy link')).toBeUndefined()
  })

  it('keeps the link visible and changes Unshare to Update while editing the publish mode', async () => {
    fileShareState.current = createShare()
    await renderModal()

    expect(button('Unshare')).toBeEnabled()
    await click('Password')

    expect(button('Copy link')).toBeEnabled()
    expect(button('Update')).toBeDisabled()
    expect(button('Update')).toHaveAttribute('data-variant', 'primary')

    await changePassword('correct horse battery staple')
    expect(button('Update')).toBeEnabled()

    await click('Update')

    expect(mockMutate).toHaveBeenLastCalledWith(
      {
        workspaceId: 'workspace-1',
        fileId: 'file-1',
        token: undefined,
        isActive: true,
        authType: 'password',
        password: 'correct horse battery staple',
      },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    )
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(mockToastSuccess).toHaveBeenLastCalledWith('Sharing updated')
  })

  it.each([
    {
      description: 'null',
      initialShare: null,
      pendingAction: 'Share',
      expectedHint: 'Share to make this file accessible to anyone with the link.',
    },
    {
      description: 'stale',
      initialShare: createShare(),
      pendingAction: 'Unshare',
      expectedHint: 'Anyone with the link can view and download this file.',
    },
  ])(
    'waits for the authoritative share read when initial display data is $description',
    async ({ initialShare, pendingAction, expectedHint }) => {
      fileShareQueryState.isFetchedAfterMount = false
      await renderModal(initialShare)

      expect(button(pendingAction)).toBeDisabled()
      expect(container).toHaveTextContent(expectedHint)
      expect(container).not.toHaveTextContent('Loading the current sharing settings...')

      fileShareState.current = createShare({
        authType: 'password',
        hasPassword: true,
      })
      fileShareQueryState.isFetchedAfterMount = true
      await renderModal(initialShare)

      expect(button('Password')).toHaveAttribute('aria-checked', 'true')
      expect(button('Unshare')).toBeEnabled()
    }
  )

  it.each([
    { mode: 'Email' as const, authType: 'email' as const, entry: 'person@example.com' },
    { mode: 'SSO' as const, authType: 'sso' as const, entry: 'example.com' },
  ])('requires an allow-list before sharing in $mode mode', async ({ mode, authType, entry }) => {
    await renderModal()
    await click(mode)

    expect(button('Share')).toBeDisabled()

    await changeAllowedEmails(entry)
    expect(button('Share')).toBeEnabled()

    await click('Share')

    expect(mockMutate).toHaveBeenLastCalledWith(
      {
        workspaceId: 'workspace-1',
        fileId: 'file-1',
        token: 'pending-token-1234567890',
        isActive: true,
        authType,
        allowedEmails: [entry],
      },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    )
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it.each([
    { mode: 'Password' as const, value: 'correct horse battery staple' },
    { mode: 'Email' as const, value: 'person@example.com' },
  ])('locks access edits and dismissal while a $mode share is pending', async ({ mode, value }) => {
    await renderModal()
    await click(mode)
    if (mode === 'Password') {
      await changePassword(value)
    } else {
      await changeAllowedEmails(value)
    }

    let finishMutation: (() => void) | undefined
    mockMutate.mockImplementationOnce(
      (_variables: MockMutationVariables, callbacks?: MockMutationCallbacks) => {
        mutationState.isPending = true
        finishMutation = callbacks?.onSuccess
      }
    )

    await click('Share')
    await renderModal()

    expect(container.querySelector('[role="dialog"]')).toHaveAttribute(
      'data-dismiss-disabled',
      'true'
    )
    expect(button('Public')).toBeDisabled()
    expect(button('Password')).toBeDisabled()
    expect(button('Email')).toBeDisabled()
    expect(button('SSO')).toBeDisabled()
    expect(button('Sharing...')).toBeDisabled()

    const editor = container.querySelector<HTMLInputElement>(
      mode === 'Password' ? '[aria-label="Password"]' : '[aria-label="Allowed emails"]'
    )
    expect(editor).toBeDisabled()

    await act(async () => {
      mutationState.isPending = false
      finishMutation?.()
    })
  })

  it('blocks a new share when public file sharing is disabled', async () => {
    permissionConfigState.current = {
      allowedFileShareAuthTypes: null,
      disablePublicFileSharing: true,
    }

    await renderModal()

    expect(button('Share')).toBeDisabled()
  })

  it('blocks sharing an inactive saved mode that is no longer allowed', async () => {
    permissionConfigState.current = {
      allowedFileShareAuthTypes: ['public'],
      disablePublicFileSharing: false,
    }
    fileShareState.current = createShare({
      isActive: false,
      authType: 'email',
      allowedEmails: ['person@example.com'],
    })

    await renderModal()

    expect(button('Email')).toHaveAttribute('aria-checked', 'true')
    expect(button('Share')).toBeDisabled()
  })

  it('allows unsharing an active saved mode that is no longer allowed', async () => {
    permissionConfigState.current = {
      allowedFileShareAuthTypes: ['public'],
      disablePublicFileSharing: false,
    }
    fileShareState.current = createShare({
      authType: 'email',
      allowedEmails: ['person@example.com'],
    })

    await renderModal()

    expect(button('Email')).toHaveAttribute('aria-checked', 'true')
    expect(button('Unshare')).toBeEnabled()

    await click('Unshare')
    await clickConfirmation('Unshare')
    expect(mockMutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ isActive: false }),
      expect.objectContaining({ onSuccess: expect.any(Function) })
    )
  })
})
