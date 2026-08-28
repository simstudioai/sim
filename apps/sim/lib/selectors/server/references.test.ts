/**
 * @vitest-environment node
 */
import { environmentUtilsMockFns, resetEnvironmentUtilsMock } from '@sim/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import { SelectorContextUnavailableError } from '@/lib/selectors/server/errors'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { resolveSelectorReferences } from '@/lib/selectors/server/references'

const baseInput = {
  selectorKey: 'imap.mailboxes' as const,
  requesterUserId: 'user-1',
  workspaceId: 'workspace-1',
}

describe('resolveSelectorReferences', () => {
  beforeEach(() => {
    resetEnvironmentUtilsMock()
  })

  it('keeps literals local and protects sensitive literal fields without loading environments', async () => {
    const protectedValues = createSelectorProtectedValues()

    const result = await resolveSelectorReferences({
      ...baseInput,
      context: {
        host: 'imap.example.com',
        port: '993',
        secure: 'true',
        username: 'mailbox-user',
        password: 'literal-password',
      },
      request: { kind: 'list' },
      protectedValues,
    })

    expect(result.context).toEqual({
      host: 'imap.example.com',
      port: '993',
      secure: 'true',
      username: 'mailbox-user',
      password: 'literal-password',
    })
    expect(result.references.size).toBe(0)
    expect(protectedValues.contains('prefix-literal-password-suffix')).toBe(true)
    expect(environmentUtilsMockFns.mockGetEffectiveEnvironmentSnapshot).not.toHaveBeenCalled()
  })

  it('resolves personal, visible shared, and hidden use-only references with workspace precedence', async () => {
    environmentUtilsMockFns.mockGetEffectiveEnvironmentSnapshot.mockResolvedValue({
      personalEncrypted: {},
      workspaceEncrypted: {},
      personalDecrypted: {
        PERSONAL_HOST: 'personal.example.com',
        SHARED_USERNAME: 'personal-shadow',
      },
      workspaceDecrypted: {
        SHARED_USERNAME: 'shared-user',
        SHARED_PASSWORD: 'hidden-password',
      },
      personalOwners: { PERSONAL_HOST: 'user-1' },
      conflicts: ['SHARED_USERNAME'],
      decryptionFailures: [],
      workspaceUnredactedKeys: ['SHARED_USERNAME'],
    })
    const protectedValues = createSelectorProtectedValues()

    const result = await resolveSelectorReferences({
      ...baseInput,
      context: {
        host: '{{PERSONAL_HOST}}',
        username: '{{SHARED_USERNAME}}',
        password: '{{SHARED_PASSWORD}}',
      },
      request: { kind: 'list' },
      protectedValues,
    })

    expect(result.context).toEqual({
      host: 'personal.example.com',
      username: 'shared-user',
      password: 'hidden-password',
    })
    expect([...result.references.values()]).toEqual([
      {
        field: 'host',
        name: 'PERSONAL_HOST',
        scope: 'personal',
        visible: true,
      },
      {
        field: 'username',
        name: 'SHARED_USERNAME',
        scope: 'workspace',
        visible: true,
      },
      {
        field: 'password',
        name: 'SHARED_PASSWORD',
        scope: 'workspace',
        visible: false,
      },
    ])
    expect(protectedValues.contains('hidden-password')).toBe(true)
  })

  it('projects missing, inaccessible, embedded, and runtime references to one context error', async () => {
    environmentUtilsMockFns.mockGetEffectiveEnvironmentSnapshot.mockResolvedValue({
      personalEncrypted: {},
      workspaceEncrypted: {},
      personalDecrypted: {},
      workspaceDecrypted: {},
      personalOwners: {},
      conflicts: [],
      decryptionFailures: ['INACCESSIBLE_SHARED'],
      workspaceUnredactedKeys: [],
    })

    const contexts = [
      { host: '{{MISSING}}', username: 'user', password: 'password' },
      { host: '{{INACCESSIBLE_SHARED}}', username: 'user', password: 'password' },
      { host: 'imap.{{HOST}}', username: 'user', password: 'password' },
      { host: '<block.output>', username: 'user', password: 'password' },
    ]

    for (const context of contexts) {
      await expect(
        resolveSelectorReferences({
          ...baseInput,
          context,
          request: { kind: 'list' },
          protectedValues: createSelectorProtectedValues(),
        })
      ).rejects.toEqual(new SelectorContextUnavailableError())
    }
  })
})
