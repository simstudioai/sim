/** @vitest-environment jsdom */
import { act, type ButtonHTMLAttributes } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/app/(auth)/components', () => ({
  AuthSubmitButton: ({ children, onClick, disabled }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type='button' onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}))

import { InviteStatusCard } from '@/app/invite/components/status-card'

it('places block disclosure content outside the description and before acceptance', async () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  try {
    await act(async () =>
      root.render(
        <InviteStatusCard
          type='invitation'
          title='Organization invitation'
          description='Join Target Team'
          details={
            <ul aria-label='Workspaces moving'>
              <li>Personal work</li>
            </ul>
          }
          actions={[{ label: 'Accept Invitation', onClick: vi.fn() }]}
        />
      )
    )
    const disclosure = container.querySelector('[aria-label="Workspaces moving"]')
    expect(disclosure?.closest('p')).toBeNull()
    expect(disclosure?.compareDocumentPosition(container.querySelector('button')!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
