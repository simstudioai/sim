/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/emcn', () => ({
  Wizard: Object.assign(({ children }: { children: ReactNode }) => <div>{children}</div>, {
    Step: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  }),
  ChipModalField: ({ title, children }: { title: string; children?: ReactNode }) => (
    <div>
      <span>{title}</span>
      {children}
    </div>
  ),
  ChipDropdown: ({
    value,
    onChange,
    options,
  }: {
    value: string[]
    onChange: (value: string[]) => void
    options: { value: string; label: string }[]
  }) => (
    <select
      multiple
      aria-label='Additional permissions'
      value={value}
      onChange={(event) =>
        onChange(Array.from(event.target.selectedOptions, (option) => option.value))
      }
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  Button: () => null,
  Chip: () => null,
  ChipInput: () => null,
  SecretInput: () => null,
}))
vi.mock('@/components/icons', () => ({ SlackIcon: () => null }))
vi.mock('@/components/integrations/slack-app-manifest', () => ({
  SlackAppManifest: ({ manifest }: { manifest: string }) => <pre>{manifest}</pre>,
}))
vi.mock('@/hooks/queries/scoped-credentials', () => ({
  useCreateScopedCredential: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateScopedCredential: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://sim.test' }))
vi.mock('@/triggers/webhook-url', () => ({
  buildSlackCustomBotRequestUrl: () => 'https://sim.test/api/webhooks/slack/custom/test-bot',
}))

import { SLACK_MANAGED_USER_SCOPES } from '@/lib/credential-groups/slack-managed-user-scopes'
import { ConnectSlackBotModal } from '@/app/workspace/[workspaceId]/integrations/components/connect-slack-bot-modal/connect-slack-bot-modal'

describe('custom Slack bot permission selection', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  function botScopes(): string[] {
    return JSON.parse(container.querySelector('pre')!.textContent!).oauth_config.scopes.bot
  }

  it.each([{ workspaceId: 'workspace-test' }, { organizationId: 'organization-test' }])(
    'includes Lists, Canvas, and full member scopes by default for %j',
    (owner) => {
      act(() => root.render(<ConnectSlackBotModal {...owner} open onOpenChange={vi.fn()} />))
      expect(botScopes()).toContain('chat:write')
      for (const scope of ['lists:read', 'lists:write', 'canvases:read', 'canvases:write']) {
        expect(botScopes()).toContain(scope)
      }
      const manifest = JSON.parse(container.querySelector('pre')!.textContent!)
      expect(manifest.oauth_config.scopes.user).toEqual([...SLACK_MANAGED_USER_SCOPES].sort())
      expect(container.textContent).not.toContain('Member access')
    }
  )

  it('selects all permissions by default, allows deselection, and restores defaults when reopened', () => {
    const onOpenChange = vi.fn()
    const render = (open: boolean) => {
      act(() =>
        root.render(
          <ConnectSlackBotModal
            workspaceId='workspace-test'
            open={open}
            onOpenChange={onOpenChange}
          />
        )
      )
    }
    render(true)
    const permissions = container.querySelector<HTMLSelectElement>('select')!
    for (const option of permissions.options) {
      expect(option.selected, option.value).toBe(true)
    }
    act(() => {
      for (const capability of ['action_lists', 'action_canvases']) {
        permissions.querySelector<HTMLOptionElement>(`option[value="${capability}"]`)!.selected =
          false
      }
      permissions.dispatchEvent(new Event('change', { bubbles: true }))
    })
    for (const scope of ['lists:read', 'lists:write', 'canvases:read', 'canvases:write']) {
      expect(botScopes()).not.toContain(scope)
    }
    render(false)
    render(true)
    for (const scope of ['lists:read', 'lists:write', 'canvases:read', 'canvases:write']) {
      expect(botScopes()).toContain(scope)
    }
  })
  it.each([{ workspaceId: 'workspace-test' }, { organizationId: 'organization-test' }])(
    'preserves the existing Slack app configuration when reconnecting %j',
    (owner) => {
      act(() =>
        root.render(
          <ConnectSlackBotModal
            {...owner}
            credentialId='existing-bot'
            initialDisplayName='Existing bot'
            open
            onOpenChange={vi.fn()}
          />
        )
      )
      expect(container.querySelector('pre')).toBeNull()
      expect(container.querySelector('select')).toBeNull()
      expect(container.textContent).toContain('Keep its existing App Manifest and permissions.')
      expect(container.textContent).not.toContain('Copy your manifest')
    }
  )
})
