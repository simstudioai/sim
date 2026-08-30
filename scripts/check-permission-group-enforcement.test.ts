import { describe, expect, it } from 'vitest'
import {
  parseCapabilityIds,
  parseFieldEnforcement,
  parseOperationCapabilities,
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
