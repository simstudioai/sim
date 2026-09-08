import { describe, expect, it } from 'vitest'
import {
  parseCapabilityIds,
  parseFieldEnforcement,
  parseOperationCapabilities,
  parseOperationRegistryMembers,
} from './check-permission-group-enforcement'

describe('operation capability parsing', () => {
  it('reads a direct declaration', () => {
    const { declarations, unreadable } = parseOperationCapabilities(`
      export const tableOperations = {
        create: defineWorkspaceOperation({
          id: 'tables.create',
          minimumRole: 'write',
          capability: 'tables.create',
        }),
      } as const
    `)

    expect(declarations).toEqual([
      expect.objectContaining({ id: 'tables.create', capability: 'tables.create' }),
    ])
    expect(unreadable).toEqual([])
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

  it('reports a wrapper written as an arrow const rather than a function', () => {
    const { declarations, unreadable } = parseOperationCapabilities(`
      const tableOperation = (id: string, capability: string) =>
        defineWorkspaceOperation({ id, minimumRole: 'write', capability })

      export const listRows = tableOperation('tables.rows.list', 'tables.use')
    `)

    expect(declarations).toEqual([])
    expect(unreadable).toHaveLength(1)
  })
})

describe('registry parsing', () => {
  it('reads capability ids in declaration order', () => {
    expect(
      parseCapabilityIds(`
        export const CAPABILITY_IDS = ['tables.use', 'files.use'] as const
      `)
    ).toEqual(['tables.use', 'files.use'])
  })

  /** Keys are matched at the registry's own two-space indentation. */
  it('reads each config key declared enforcement', () => {
    const enforcement = parseFieldEnforcement(
      [
        'export const PERMISSION_GROUP_FIELDS = {',
        "  allowedIntegrations: allowlist(z.string(), 'executor', {",
        "    limited: 'x',",
        "    empty: 'y',",
        '  }),',
        "  hideTablesTab: booleanRestriction('capability', {",
        "    id: 'hide-tables',",
        "    hint: 'Hide the Tables module from the sidebar.',",
        '  }),',
        '} satisfies Record<string, PermissionGroupField>',
      ].join('\n')
    )

    expect(enforcement.get('allowedIntegrations')).toBe('executor')
    expect(enforcement.get('hideTablesTab')).toBe('capability')
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

  it('reads a domain builder that passes an object literal straight through', () => {
    const { declarations, unreadable } = parseOperationCapabilities(`
      export const auditLogOperations = {
        list: defineAuditLogOperation({
          id: 'audit_logs.list',
          capability: 'none',
        }),
      } as const
    `)

    expect(declarations).toEqual([
      expect.objectContaining({ id: 'audit_logs.list', capability: 'none' }),
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

  it('reads a wrapped literal when the factory forwards the operation capability by property', () => {
    const { declarations, unreadable, overridable } = parseOperationCapabilities(`
      function defineKnowledgeOperation(operation: WorkspaceOperation) {
        const organizationOperation = defineOrganizationOperation({
          id: operation.id,
          capability: operation.capability,
          minimumRole: 'member',
        })
        return Object.freeze({ ...operation, organizationOperation })
      }

      export const knowledgeOperations = {
        search: defineKnowledgeOperation(
          defineWorkspaceOperation({
            id: 'knowledge.search',
            minimumRole: 'read',
            capability: 'knowledge.use',
          })
        ),
      } as const
    `)

    expect(declarations).toEqual([
      expect.objectContaining({ id: 'knowledge.search', capability: 'knowledge.use' }),
    ])
    expect(unreadable).toEqual([])
    expect(overridable).toEqual([])
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

  it('enumerates each member with the line span it occupies', () => {
    const members = parseOperationRegistryMembers(registrySource)

    expect(members.map((member) => `${member.registry}.${member.member}`)).toEqual([
      'probeOperations.list',
      'probeOperations.read',
    ])
    const [list, read] = members
    expect(list.startLine).toBe(3)
    expect(read.startLine).toBe(4)
    expect(read.endLine).toBe(8)
  })

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

  it('ignores a comment or a string that looks like a member key', () => {
    const members = parseOperationRegistryMembers(`
      export const probeOperations = {
        // permission-group-exempt: nothing: here is a member
        read: defineWorkspaceOperation({
          id: 'probe.read',
          minimumRole: 'read',
          capability: 'tables.use',
        }),
      } as const
    `)

    expect(members.map((member) => member.member)).toEqual(['read'])
  })

  it('reads no registry from a module that exports none', () => {
    expect(
      parseOperationRegistryMembers(`
        export const applyWorkflowOperations = defineAuthorizedWorkflowUseCase({
          operation: workflowOperations.applyOperations,
        })
      `)
    ).toEqual([])
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

  it('reports the override however the parameter is spelled', () => {
    const { overridable } = parseOperationCapabilities(
      'function defineKnowledgeOperation(\n' +
        '  id: string,\n' +
        '  patch: Partial<KnowledgeOperation> = {}\n' +
        ') {\n' +
        "  return defineWorkspaceOperation({ id, capability: 'knowledge.use', ...patch })\n" +
        '}\n'
    )

    expect(overridable).toEqual([1])
  })

  /**
   * `Partial` over something that is not an operation is ordinary code — a
   * factory taking a partial audit payload has nothing to say about capability.
   */
  it('leaves a Partial of an unrelated type alone', () => {
    const { overridable } = parseOperationCapabilities(
      'function defineTableOperation(id: string, audit?: Partial<AuditPayload>) {\n' +
        "  return defineWorkspaceOperation({ id, capability: 'tables.use', audit })\n" +
        '}\n'
    )

    expect(overridable).toEqual([])
  })

  it('leaves a factory with named parameters alone', () => {
    const { declarations, overridable } = parseOperationCapabilities(
      'function defineTableOperation(id: string, capability: string) {\n' +
        '  return defineWorkspaceOperation({ id, capability })\n' +
        '}\n' +
        "defineTableOperation('table.read', 'tables.use')\n"
    )

    expect(overridable).toEqual([])
    expect(declarations).toEqual([{ id: 'table.read', line: 4, capability: 'tables.use' }])
  })
})
