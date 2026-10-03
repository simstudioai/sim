import { describe, expect, it } from 'vitest'
import {
  hasExemptAnnotation,
  parseOperationCapabilities,
  parseOperationRegistryMembers,
} from './check-permission-group-enforcement'

describe('operation capability parsing', () => {
  it('reads reused const and registry owner policies without hiding the second declaration', () => {
    const { declarations, unreadable } = parseOperationCapabilities(`
      export const read = defineWorkspaceOperation({ id: 'chats.read', capability: 'none' })
      export const chatOperations = {
        steer: defineWorkspaceOperation({ id: 'chats.steer', capability: 'copilot.use' }),
      }
      const readOrganization = defineOrganizationOperation({ id: read.id, capability: read.capability })
      const steerOrganization = defineOrganizationOperation({ id: chatOperations.steer.id, capability: chatOperations.steer.capability })
      const overridden = defineOrganizationOperation({ id: read.id, capability: 'copilot.use' })
    `)
    expect(declarations.map(({ id, capability }) => ({ id, capability }))).toEqual([
      { id: 'chats.read', capability: 'none' },
      { id: 'chats.steer', capability: 'copilot.use' },
      { id: 'chats.read', capability: 'none' },
      { id: 'chats.steer', capability: 'copilot.use' },
      { id: 'chats.read', capability: 'copilot.use' },
    ])
    expect(unreadable).toEqual([])
  })

  it('keeps imported, missing and unresolved owner-policy fields visible as failures', () => {
    const { declarations, unreadable } = parseOperationCapabilities(`
      const read = defineOrganizationOperation({ id: imported.id, capability: imported.capability })
      const stop = defineWorkspaceOperation({ id: 'chats.stop', capability: missing.capability })
      const organizationStop = defineOrganizationOperation({ id: stop.id, capability: stop.capability })
    `)
    expect(unreadable).toHaveLength(1)
    expect(declarations).toHaveLength(2)
    expect(declarations.every((entry) => entry.capability === undefined)).toBe(true)
  })

  it('accepts a TSDoc reason but rejects an empty or separated exemption', () => {
    expect(
      hasExemptAnnotation('/** permission-group-exempt: owned history only */\noperation()', 2)
    ).toBe(true)
    expect(hasExemptAnnotation('/** permission-group-exempt: */\noperation()', 2)).toBe(false)
    expect(
      hasExemptAnnotation(
        '/** permission-group-exempt: owned history only */\nother()\noperation()',
        3
      )
    ).toBe(false)
  })

  it('resolves call sites of a function factory without reporting the factory itself', () => {
    const { declarations, unreadable } = parseOperationCapabilities(`
      function tableOperation(id: string, capability: string) {
        return defineWorkspaceOperation({ id, minimumRole: 'write', capability })
      }

      export const listRows = tableOperation('tables.rows.list', 'tables.use')
      export const readRow = tableOperation('tables.rows.read', 'tables.use')
    `)

    expect(declarations.map((declaration) => declaration.id)).toEqual([
      'tables.rows.list',
      'tables.rows.read',
    ])
    expect(declarations.every((declaration) => declaration.capability === 'tables.use')).toBe(true)
    expect(unreadable).toEqual([])
  })

  /**
   * The two silent-drop forms. Each used to vanish from the count with the audit
   * still printing a tick; both are now findings.
   */
  it('reports a declaration whose id is a const reference', () => {
    const { declarations, unreadable } = parseOperationCapabilities(`
      const TABLE_CREATE_ID = 'tables.create'

      export const create = defineWorkspaceOperation({
        id: TABLE_CREATE_ID,
        minimumRole: 'write',
        capability: 'tables.create',
      })
    `)

    expect(declarations).toEqual([])
    expect(unreadable).toHaveLength(1)
  })
})

/**
 * The blind spot that shipped five ungated OAuth-connection operations: a domain
 * that mints operations through a builder of its own, never calling
 * `defineWorkspaceOperation`, so nothing read what it declared and the audit
 * still printed a tick. Both halves of the fix are pinned here — the parsers now
 * follow the `define*Operation` family, and the registry check names any member
 * they still could not read.
 */
describe('operation builders other than defineWorkspaceOperation', () => {
  it('reads a domain builder that takes an id and a capability positionally', () => {
    const { declarations, unreadable } = parseOperationCapabilities(`
      function defineCredentialUserOperation(id: string, capability: string) {
        return Object.freeze({ id, capability, principalKinds: ['session'] })
      }

      export const credentialUserOperations = {
        listOAuthConnections: defineCredentialUserOperation(
          'credentials.oauth_connections.list',
          'integrations.manage'
        ),
        disconnectOAuth: defineCredentialUserOperation(
          'credentials.oauth_connections.disconnect',
          'integrations.manage'
        ),
      } as const
    `)

    expect(declarations).toEqual([
      expect.objectContaining({
        id: 'credentials.oauth_connections.list',
        capability: 'integrations.manage',
      }),
      expect.objectContaining({
        id: 'credentials.oauth_connections.disconnect',
        capability: 'integrations.manage',
      }),
    ])
    expect(unreadable).toEqual([])
  })

  /**
   * The wrapper form. Counting the outer and the inner call separately would
   * double every credential operation, so the nested match is skipped — its id
   * and capability are already carried by the outer call's text.
   */
  it('counts a wrapped operation once', () => {
    const { declarations } = parseOperationCapabilities(`
      export const credentialOperations = {
        read: defineCredentialOperation(
          defineWorkspaceOperation({
            id: 'credentials.read',
            minimumRole: 'read',
            capability: 'integrations.manage',
          }),
          'member'
        ),
      } as const
    `)

    expect(declarations).toEqual([
      expect.objectContaining({ id: 'credentials.read', capability: 'integrations.manage' }),
    ])
  })

  it('reports a builder that mints the operation itself from a bare id argument', () => {
    const { declarations, unreadable } = parseOperationCapabilities(`
      function defineCredentialUserOperation(id: string) {
        return Object.freeze({ id, principalKinds: ['session'] })
      }

      export const credentialUserOperations = {
        listOAuthConnections: defineCredentialUserOperation('credentials.oauth_connections.list'),
      } as const
    `)

    expect(declarations).toEqual([])
    expect(unreadable).toHaveLength(1)
  })
})

describe('registry completeness', () => {
  const registrySource = `
      export const probeOperations = {
        list: Object.freeze({ id: 'probe.list' as const }),
        read: defineWorkspaceOperation({
          id: 'probe.read',
          minimumRole: 'read',
          capability: 'tables.use',
        }),
      } as const
    `

  /**
   * The check the audit runs: a member no parsed declaration falls inside is a
   * member nothing read. `list` is minted by no builder at all, so it yields
   * nothing — and yielding nothing is what used to read as success.
   */
  it('leaves a member no parser read outside every parsed line', () => {
    const { declarations, unreadable } = parseOperationCapabilities(registrySource)
    const readLines = [...declarations.map((declaration) => declaration.line), ...unreadable]

    const unread = parseOperationRegistryMembers(registrySource).filter(
      (member) => !readLines.some((line) => line >= member.startLine && line <= member.endLine)
    )

    expect(unread.map((member) => member.member)).toEqual(['list'])
  })
})

describe('a factory that admits a Partial override of the operation', () => {
  /**
   * Nothing in the tree does this today, which is why it is probed here rather
   * than caught in the wild: the capability the parsers read is the literal in
   * the factory body, and a `Partial<WorkspaceOperation>` spread over the result
   * can replace it with `'none'` after the audit has already approved it. The
   * factory is reported as unparseable rather than resolved — the override's
   * value lives at the call site, and following it is the call graph this audit
   * does not have.
   */
  it('reports an `overrides?: Partial<WorkspaceOperation>` parameter', () => {
    const { overridable } = parseOperationCapabilities(
      'function defineTableOperation(id: string, overrides?: Partial<WorkspaceOperation>) {\n' +
        "  return defineWorkspaceOperation({ id, capability: 'tables.use', ...overrides })\n" +
        '}\n'
    )

    expect(overridable).toEqual([1])
  })
})
