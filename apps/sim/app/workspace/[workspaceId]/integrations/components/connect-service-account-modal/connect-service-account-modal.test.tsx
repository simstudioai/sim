/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }))

vi.mock('@sim/emcn', () => ({
  ChipModal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChipModalBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChipModalHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  ChipModalError: ({ children }: { children: ReactNode }) => <div role='alert'>{children}</div>,
  ChipModalField: ({
    type,
    title,
    value,
    onChange,
  }: {
    type: string
    title: string
    value?: string
    onChange: (value: string) => void
  }) =>
    type === 'file' ? null : (
      <textarea
        aria-label={title}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    ),
  ChipModalFooter: ({
    primaryAction,
  }: {
    primaryAction: { label: string; onClick: () => void; disabled: boolean }
  }) => (
    <button type='button' onClick={primaryAction.onClick} disabled={primaryAction.disabled}>
      {primaryAction.label}
    </button>
  ),
  SecretInput: () => null,
}))

vi.mock('@/hooks/queries/scoped-credentials', () => ({
  useCreateScopedCredential: () => ({ mutateAsync: mocks.create, isPending: false }),
  useUpdateScopedCredential: () => ({ mutateAsync: mocks.update, isPending: false }),
}))
vi.mock('@/blocks/brand-icon', () => ({ withBrandIcon: () => null }))
vi.mock('@/lib/integrations/credential-display', () => ({
  getServiceAccountCoverageSentence: () => '',
}))
vi.mock(
  '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal/client-credential-account-modal',
  () => ({ ClientCredentialAccountModal: () => null })
)
vi.mock(
  '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal/token-service-account-modal',
  () => ({ TokenServiceAccountModal: () => null })
)
vi.mock(
  '@/app/workspace/[workspaceId]/integrations/components/connect-slack-bot-modal/connect-slack-bot-modal',
  () => ({ ConnectSlackBotModal: () => null })
)

import { ConnectServiceAccountModal } from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal/connect-service-account-modal'

const serviceAccountJson = JSON.stringify({
  type: 'service_account',
  client_email: 'test@example.invalid',
  private_key: 'test-private-key',
  project_id: 'test-project',
})

describe('Google service-account creation', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mocks.create.mockResolvedValue({ credential: { id: 'credential-1' } })
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it.each([{ organizationId: 'org-1' }, { workspaceId: 'workspace-1' }])(
    'submits the Google provider and exact owner for %j',
    async (owner) => {
      const onOpenChange = vi.fn()
      const onCreated = vi.fn()
      act(() =>
        root.render(
          <ConnectServiceAccountModal
            {...owner}
            open
            onOpenChange={onOpenChange}
            onCreated={onCreated}
            serviceAccountProviderId='google-service-account'
            serviceName='Google Drive'
            serviceIcon={() => null}
          />
        )
      )

      const input = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="JSON key"]')!
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
          input,
          `  ${serviceAccountJson}  `
        )
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => {
        container.querySelector<HTMLButtonElement>('button')!.click()
      })

      expect(onOpenChange).toHaveBeenCalledWith(false)
      expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
        ...owner,
        type: 'service_account',
        providerId: 'google-service-account',
        displayName: 'test@example.invalid',
        description: undefined,
        serviceAccountJson,
      })
      expect(onCreated).toHaveBeenCalledWith('credential-1')
      expect(mocks.update).not.toHaveBeenCalled()
    }
  )
})
