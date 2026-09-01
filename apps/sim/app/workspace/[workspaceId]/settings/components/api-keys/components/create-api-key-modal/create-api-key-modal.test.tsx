/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { primaryActions } = vi.hoisted(() => ({
  primaryActions: { current: [] as { label: string; disabled: boolean }[] },
}))

vi.mock('@sim/emcn', () => ({
  ButtonGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ButtonGroupItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChipModal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChipModalBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChipModalError: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChipModalField: ({ value, onChange }: { value?: string; onChange?: (v: string) => void }) => (
    <input
      data-testid='key-name'
      value={value ?? ''}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
  ChipModalFooter: ({ primaryAction }: { primaryAction: { label: string; disabled: boolean } }) => {
    primaryActions.current.push(primaryAction)
    return <div />
  },
  ChipModalHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SecretReveal: () => <div />,
}))

vi.mock('@/hooks/queries/api-keys', () => ({
  useCreateApiKey: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))

import { CreateApiKeyModal } from '@/app/workspace/[workspaceId]/settings/components/api-keys/components/create-api-key-modal/create-api-key-modal'

let container: HTMLDivElement
let root: Root

/** The success dialog renders a second footer, so pick the create one. */
function latestCreateAction() {
  return primaryActions.current.filter((action) => action.label === 'Create').at(-1)!
}

async function render(props: {
  open: boolean
  defaultKeyType: 'personal' | 'workspace'
  allowPersonalApiKeys: boolean
}) {
  await act(async () => {
    root.render(
      <CreateApiKeyModal
        open={props.open}
        onOpenChange={vi.fn()}
        workspaceId='workspace-1'
        allowPersonalApiKeys={props.allowPersonalApiKeys}
        canManageWorkspaceKeys={false}
        defaultKeyType={props.defaultKeyType}
      />
    )
  })
}

async function typeName() {
  const input = container.querySelector<HTMLInputElement>('[data-testid="key-name"]')!
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, 'CI key')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('CreateApiKeyModal key-type seeding', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    primaryActions.current = []
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  /**
   * The settings page mounts this modal closed, while its permission-group
   * query is still pending — so `defaultKeyType` is the fail-closed
   * `'workspace'` and only becomes `'personal'` once the policy answers. A
   * non-admin has no type selector rendered, so a selection seeded at mount is
   * one they can never change and never create with.
   */
  it('adopts the default the policy resolved to, not the one present at mount', async () => {
    await render({ open: false, defaultKeyType: 'workspace', allowPersonalApiKeys: true })
    await render({ open: false, defaultKeyType: 'personal', allowPersonalApiKeys: true })
    await render({ open: true, defaultKeyType: 'personal', allowPersonalApiKeys: true })
    await typeName()

    expect(latestCreateAction().disabled).toBe(false)
  })

  it('still refuses a workspace key a non-admin may not create', async () => {
    await render({ open: false, defaultKeyType: 'workspace', allowPersonalApiKeys: false })
    await render({ open: true, defaultKeyType: 'workspace', allowPersonalApiKeys: false })
    await typeName()

    expect(latestCreateAction().disabled).toBe(true)
  })
})
