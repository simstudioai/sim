import type { ComponentProps, PropsWithChildren } from 'react'
import { JSDOM } from 'jsdom'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const validation = vi.hoisted(() => ({
  current: { isChecking: false, error: 'Use lowercase letters', isValid: false } as {
    isChecking: boolean
    error: string | null
    isValid: boolean
  },
}))

vi.mock('@sim/emcn', () => ({
  Input: (props: ComponentProps<'input'>) => <input {...props} />,
  Label: (props: ComponentProps<'label'>) => (
    <label htmlFor={props.htmlFor} className={props.className}>
      {props.children}
    </label>
  ),
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  Tooltip: {
    Root: ({ children }: PropsWithChildren) => <>{children}</>,
    Trigger: ({ children }: PropsWithChildren) => <>{children}</>,
    Content: ({ children }: PropsWithChildren) => <>{children}</>,
  },
}))
vi.mock('@sim/emcn/icons', () => ({ Check: () => null, TriangleAlert: () => null }))
vi.mock('@sim/logger', () => ({ createLogger: () => ({}) }))
vi.mock('@/components/ui', () => ({ GeneratedPasswordInput: () => null }))
vi.mock('@/lib/core/config/deployment-shape', () => ({ useDeploymentShape: () => ({}) }))
vi.mock('@/lib/core/utils/urls', () => ({
  getBaseUrl: () => 'https://sim.ai',
  getEmailDomain: () => 'sim.ai',
}))
vi.mock('@/lib/messaging/email/validation', () => ({ validateAllowlistEntry: () => true }))
vi.mock('@/lib/workflows/streaming/output-selector', () => ({
  formatInternalOutputSelector: () => '',
}))
vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/chat/components/output-select/output-select',
  () => ({
    OutputSelect: () => null,
  })
)
vi.mock('@/hooks/queries/chats', () => ({
  useCreateChat: () => ({}),
  useDeleteChat: () => ({}),
  useRevealChatPassword: () => ({}),
  useUpdateChat: () => ({}),
}))
vi.mock('@/hooks/use-permission-config', () => ({ usePermissionConfig: () => ({}) }))
vi.mock('./hooks', () => ({ useIdentifierValidation: () => validation.current }))

import { IdentifierInput } from './chat'

function renderIdentifier() {
  return new JSDOM(renderToStaticMarkup(<IdentifierInput value='bad path' onChange={vi.fn()} />))
    .window.document
}

describe('deploy URL field error', () => {
  it('announces and associates the URL validation error with its input', () => {
    validation.current = { isChecking: false, error: 'Use lowercase letters', isValid: false }
    const document = renderIdentifier()
    const input = document.querySelector<HTMLInputElement>('#chat-url')
    const alert = document.querySelector<HTMLElement>('[role="alert"]')

    expect(alert?.textContent).toBe('Use lowercase letters')
    expect(alert?.className).toBe('mt-[6.5px] text-[var(--text-error)] text-caption')
    expect(input?.getAttribute('aria-invalid')).toBe('true')
    expect(input?.getAttribute('aria-describedby')).toBe(alert?.id)
    expect(alert?.id).toBeTruthy()
    expect(document.querySelector('label')?.htmlFor).toBe(input?.id)
  })

  it('omits the error relationship when the URL is valid', () => {
    validation.current = { isChecking: false, error: null, isValid: true }
    const document = renderIdentifier()
    const input = document.querySelector<HTMLInputElement>('#chat-url')

    expect(document.querySelector('[role="alert"]')).toBeNull()
    expect(input?.getAttribute('aria-invalid')).toBe('false')
    expect(input?.hasAttribute('aria-describedby')).toBe(false)
  })
})
