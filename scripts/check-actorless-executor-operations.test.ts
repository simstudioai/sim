import { describe, expect, it } from 'vitest'
import {
  auditSubjectRequirements,
  parseOperationPolicies,
  referencedOperations,
} from './check-actorless-executor-operations'

describe('operation policy parsing', () => {
  it('reads an inline delegatedServices list', () => {
    const policies = parseOperationPolicies(`
      export const logOperations = {
        list: defineWorkspaceOperation({
          id: 'logs.list',
          delegatedServices: ['copilot', 'executor'],
        }),
        readStats: defineWorkspaceOperation({
          id: 'logs.read_stats',
          delegatedServices: ['copilot'],
        }),
      } as const
    `)

    expect(policies.get('logOperations.list')).toBe(true)
    expect(policies.get('logOperations.readStats')).toBe(false)
  })

  it('resolves a policy spread into the definition', () => {
    const policies = parseOperationPolicies(`
      const READER_POLICY = {
        principalKinds: ['session', 'delegated'],
        delegatedServices: ['copilot', 'executor'],
      } as const
      export const logOperations = {
        readDetail: defineWorkspaceOperation({ id: 'logs.read_detail', ...READER_POLICY }),
      } as const
    `)

    expect(policies.get('logOperations.readDetail')).toBe(true)
  })

  it('resolves an operation declared through a same-file factory', () => {
    const policies = parseOperationPolicies(`
      const TOOL_POLICY = { delegatedServices: ['copilot', 'executor'] } as const
      const UI_POLICY = { delegatedServices: ['copilot'] } as const
      function toolReadOperation<const Id extends string>(id: Id) {
        return defineWorkspaceOperation({ id, minimumRole: 'read', ...TOOL_POLICY })
      }
      function readOperation<const Id extends string>(id: Id) {
        return defineWorkspaceOperation({ id, minimumRole: 'read', ...UI_POLICY })
      }
      export const tableOperations = {
        queryRows: toolReadOperation('tables.rows.query'),
        listTables: readOperation('tables.list'),
      } as const
    `)

    expect(policies.get('tableOperations.queryRows')).toBe(true)
    expect(policies.get('tableOperations.listTables')).toBe(false)
  })

  it('treats an operation with no delegated services as executor-free', () => {
    const policies = parseOperationPolicies(`
      export const workspaceOperations = {
        read: defineWorkspaceOperation({ id: 'workspaces.read', minimumRole: 'read' }),
      } as const
    `)

    expect(policies.get('workspaceOperations.read')).toBe(false)
  })
})

describe('operation references', () => {
  it('collects only declared operations', () => {
    const referenced = referencedOperations(
      `
      const useCase = defineAuthorizedWorkspaceUseCase({
        operation: logOperations.readDetail,
        execute: () => input.signal?.throwIfAborted(),
      })
    `,
      new Set(['logOperations.readDetail', 'logOperations.list'])
    )

    expect(referenced).toEqual(['logOperations.readDetail'])
  })
})

describe('subject requirement audit', () => {
  const call = '    const userId = requirePrincipalSubjectUserId(principal)'

  it('flags an unannotated call', () => {
    const findings = auditSubjectRequirements(`function run() {\n${call}\n}`, ['ops.thing'])

    expect(findings).toEqual([
      { file: '', line: 2, reason: 'unannotated', operations: ['ops.thing'] },
    ])
  })

  it('accepts an annotated call', () => {
    const source = `function run() {\n    // actorless-unsupported: skills belong to a person\n${call}\n}`

    expect(auditSubjectRequirements(source, [])).toEqual([])
  })

  it('tolerates context comments above the annotation', () => {
    const source = [
      'function run() {',
      '    // The library is per-user.',
      '    // actorless-unsupported: skills belong to a person',
      call,
      '}',
    ].join('\n')

    expect(auditSubjectRequirements(source, [])).toEqual([])
  })

  it('rejects an annotation with no reason', () => {
    const source = `function run() {\n    // actorless-unsupported:\n${call}\n}`

    expect(auditSubjectRequirements(source, [])).toEqual([
      { file: '', line: 3, reason: 'empty-reason', operations: [] },
    ])
  })

  it('ignores an annotation separated from the call by code', () => {
    const source = [
      'function run() {',
      '    // actorless-unsupported: not attached to the call below',
      '    const workspaceId = context.workspaceId',
      call,
      '}',
    ].join('\n')

    expect(auditSubjectRequirements(source, [])).toEqual([
      { file: '', line: 4, reason: 'unannotated', operations: [] },
    ])
  })
})
