import { describe, expect, it } from 'vitest'
import type { ExecutableToolConfig, HttpMethod, ToolEffect } from '../apps/sim/tools/types'
import {
  findToolEffectJustifications,
  findToolEffectViolations,
  type ToolEffectJustification,
} from './check-tool-effects'

function httpTool(
  id: string,
  effect: ToolEffect | undefined,
  method: HttpMethod | (() => HttpMethod)
): ExecutableToolConfig {
  return {
    id,
    name: id,
    description: id,
    version: '1.0.0',
    effect: effect as ToolEffect,
    params: {},
    request: { url: 'https://api.example.com', method, headers: () => ({}) },
  }
}

function internalTool(id: string, effect: ToolEffect): ExecutableToolConfig {
  return {
    id,
    name: id,
    description: id,
    version: '1.0.0',
    effect,
    params: {},
    operation: { input: (params) => params },
  }
}

const reasons = (
  tools: Record<string, ExecutableToolConfig>,
  justifications: ToolEffectJustification[] = []
) => findToolEffectViolations(tools, justifications).map((v) => `${v.toolId}: ${v.reason}`)

describe('tool effect audit', () => {
  it('rejects a tool without an effect or with an unknown one', () => {
    expect(
      reasons({
        missing: httpTool('missing', undefined, 'GET'),
        bogus: httpTool('bogus', 'delete' as ToolEffect, 'GET'),
      })
    ).toEqual([
      expect.stringMatching(/^bogus: declares effect "delete"/),
      'missing: declares no effect',
    ])
  })

  it('rejects a static verb that contradicts the label', () => {
    expect(
      reasons({
        get_write: httpTool('get_write', 'write', 'GET'),
        head_write: httpTool('head_write', 'write', 'HEAD'),
        put_read: httpTool('put_read', 'read', 'PUT'),
        patch_read: httpTool('patch_read', 'read', 'PATCH'),
        delete_read: httpTool('delete_read', 'read', 'DELETE'),
      })
    ).toEqual([
      expect.stringMatching(/^delete_read: sends DELETE but declares effect 'read'/),
      expect.stringMatching(/^get_write: sends GET but declares effect 'write'/),
      expect.stringMatching(/^head_write: sends HEAD/),
      expect.stringMatching(/^patch_read: sends PATCH/),
      expect.stringMatching(/^put_read: sends PUT/),
    ])
  })

  it('rejects a read whose function-valued verb can return PUT, PATCH, or DELETE', () => {
    expect(
      reasons({
        dynamic_delete: httpTool('dynamic_delete', 'read', () => 'DELETE'),
        dynamic_write: httpTool('dynamic_write', 'write', () => 'DELETE'),
      })
    ).toEqual([
      expect.stringMatching(
        /^dynamic_delete: sends DELETE from its function-valued method but declares effect 'read'/
      ),
    ])
  })

  it('leaves POST, other function-valued verbs, and in-process operations to the declared semantics', () => {
    expect(
      reasons({
        search: httpTool('search', 'read', 'POST'),
        send: httpTool('send', 'write', 'POST'),
        dynamic: httpTool('dynamic', 'read', () => 'GET'),
        query: internalTool('query', 'read'),
      })
    ).toEqual([])
  })

  it('accepts a contradiction justified on the effect of that tool', () => {
    const justifications = findToolEffectJustifications(
      'tool.ts',
      `export const tool = {
  id: 'get_then_patch',
  version: '1.0.0',
  // tool-effect: the GET reads the event; transformResponse then PATCHes it
  effect: 'write',
}`
    )

    expect(justifications).toEqual([{ file: 'tool.ts', line: 5, toolId: 'get_then_patch' }])
    expect(
      reasons({ get_then_patch: httpTool('get_then_patch', 'write', 'GET') }, justifications)
    ).toEqual([])
  })

  it('does not let an annotation on one tool justify another', () => {
    const justifications = findToolEffectJustifications(
      'tools.ts',
      `const justified = {
  id: 'justified',
  // tool-effect: postProcess writes
  effect: 'write',
}
const other = {
  id: 'other',
  effect: 'write',
}`
    )

    expect(
      reasons(
        {
          justified: httpTool('justified', 'write', 'GET'),
          other: httpTool('other', 'write', 'GET'),
        },
        justifications
      )
    ).toEqual([expect.stringMatching(/^other: sends GET/)])
  })

  it('rejects a stale annotation and one it cannot attribute to a tool', () => {
    const justifications = [
      ...findToolEffectJustifications(
        'stale.ts',
        `const stale = {
  id: 'stale',
  // tool-effect: no longer needed
  effect: 'read',
}`
      ),
      ...findToolEffectJustifications(
        'factory.ts',
        `const make = (id: string) => ({
  id,
  // tool-effect: cannot be attributed
  effect: 'write',
})`
      ),
    ]

    expect(reasons({ stale: httpTool('stale', 'read', 'GET') }, justifications)).toEqual([
      'factory.ts:4: // tool-effect: annotation is not on the effect of a registered tool with a literal id',
      'stale: has a // tool-effect: annotation but its verb agrees with its effect; remove it',
    ])
  })
})
