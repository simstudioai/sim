import { parsePrincipal, serializePrincipal } from '@sim/auth/principal'
import { createDelegatedPrincipal } from '@sim/testing/factories/principal.factory'
import { describe, expect, it } from 'vitest'
import { requireAllowedWorkspacePrincipal } from '@/lib/core/application/workspace-authorization'
import { secretOperations } from '@/lib/secrets/application/operations'
import { fileOperations } from '@/lib/workspace-files/application/operations'

const restriction = {
  version: 1,
  kind: 'external_mailer',
  admissionId: 'admission-1',
  inboxTaskId: 'task-1',
  workspaceId: 'workspace-1',
} as const

const principal = {
  ...createDelegatedPrincipal({ workspaceId: 'workspace-1', serviceId: 'copilot' }),
  executionRestriction: restriction,
}

describe('restricted external Mailer delegation', () => {
  it('denies secret mutation even when the operation only requires a read role', () => {
    expect(() => requireAllowedWorkspacePrincipal(principal, secretOperations.set)).toThrow()
    expect(() => requireAllowedWorkspacePrincipal(principal, secretOperations.delete)).toThrow()
  })

  it('denies secret reads and file mutation but retains authorized file read admission', () => {
    expect(() => requireAllowedWorkspacePrincipal(principal, secretOperations.list)).toThrow()
    expect(() => requireAllowedWorkspacePrincipal(principal, fileOperations.rename)).toThrow()
    expect(() =>
      requireAllowedWorkspacePrincipal(principal, fileOperations.readContent)
    ).not.toThrow()
  })

  it('retains the restriction after a durable principal round trip', () => {
    const restored = parsePrincipal(serializePrincipal(principal))
    expect(() => requireAllowedWorkspacePrincipal(restored, secretOperations.set)).toThrow()
    expect(() =>
      requireAllowedWorkspacePrincipal(restored, fileOperations.readContent)
    ).not.toThrow()
  })

  it('does not restrict an ordinary Copilot principal', () => {
    const ordinary = createDelegatedPrincipal({ workspaceId: 'workspace-1', serviceId: 'copilot' })
    expect(() => requireAllowedWorkspacePrincipal(ordinary, secretOperations.set)).not.toThrow()
  })
})
