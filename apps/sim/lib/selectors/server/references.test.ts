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

  it('keeps browser-known literals local without treating them as server-only secrets', async () => {
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
    expect(protectedValues.contains('prefix-literal-password-suffix')).toBe(false)
    expect(environmentUtilsMockFns.mockResolveEffectiveEnvironmentVariables).not.toHaveBeenCalled()
  })

  it('resolves personal, visible shared, and hidden use-only references with workspace precedence', async () => {
    environmentUtilsMockFns.mockResolveEffectiveEnvironmentVariables.mockResolvedValue({
      PERSONAL_HOST: {
        value: 'personal.example.com',
        scope: 'personal',
        visible: true,
      },
      SHARED_USERNAME: {
        value: 'shared-user',
        scope: 'workspace',
        visible: true,
      },
      SHARED_PASSWORD: {
        value: 'hidden-password',
        scope: 'workspace',
        visible: false,
      },
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
    expect(protectedValues.contains('prefix-personal.example.com-suffix')).toBe(false)
    expect(protectedValues.contains('prefix-shared-user-suffix')).toBe(false)
    expect(environmentUtilsMockFns.mockResolveEffectiveEnvironmentVariables).toHaveBeenCalledWith(
      'user-1',
      'workspace-1',
      ['PERSONAL_HOST', 'SHARED_USERNAME', 'SHARED_PASSWORD']
    )
  })

  it('projects missing, inaccessible, embedded, and runtime references to one context error', async () => {
    environmentUtilsMockFns.mockResolveEffectiveEnvironmentVariables.mockResolvedValue({})

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

  it('loads duplicate references once while retaining field-level provenance', async () => {
    environmentUtilsMockFns.mockResolveEffectiveEnvironmentVariables.mockResolvedValue({
      REPEATED: {
        value: 'resolved-value',
        scope: 'workspace',
        visible: false,
      },
    })

    const result = await resolveSelectorReferences({
      ...baseInput,
      context: {
        host: '{{REPEATED}}',
        port: '993',
        secure: 'true',
        username: '{{REPEATED}}',
        password: 'literal-password',
      },
      request: { kind: 'detail', id: '{{REPEATED}}' },
      protectedValues: createSelectorProtectedValues(),
    })

    expect(environmentUtilsMockFns.mockResolveEffectiveEnvironmentVariables).toHaveBeenCalledWith(
      'user-1',
      'workspace-1',
      ['REPEATED']
    )
    expect(result.context).toMatchObject({
      host: 'resolved-value',
      username: 'resolved-value',
    })
    expect(result.request).toEqual({ kind: 'detail', id: 'resolved-value' })
    expect([...result.references.keys()]).toEqual(['host', 'username', 'request.id'])
  })
})
