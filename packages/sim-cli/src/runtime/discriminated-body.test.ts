import { Command } from 'commander'
import { describe, expect, it, vi } from 'vitest'
import type { OperationSpec } from '#sim-cli/runtime/types'

const { operation } = vi.hoisted(() => ({
  operation: {
    method: 'POST',
    path: '/api/v2/requests/[requestId]/resolve',
    pathParams: ['requestId'],
    body: {
      action: { kind: 'enum', required: true, values: ['apply', 'decline'] },
      expectedFingerprint: { kind: 'string' },
      newLimitCredits: { kind: 'integer' },
      reason: { kind: 'string' },
      mode: { kind: 'enum', values: ['automatic', 'manual'] },
    },
    bodyDiscriminator: {
      field: 'action',
      variants: {
        apply: {
          action: { kind: 'string', required: true },
          expectedFingerprint: { kind: 'string', required: true },
          newLimitCredits: { kind: 'integer' },
          mode: { kind: 'enum', values: ['automatic'], default: 'automatic' },
        },
        decline: {
          action: { kind: 'string', required: true },
          reason: { kind: 'string', required: true },
          mode: { kind: 'enum', values: ['manual'], default: 'manual' },
        },
      },
    },
  } satisfies OperationSpec,
}))

vi.mock('#sim-cli/generated/v2-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#sim-cli/generated/v2-api')>()
  return { ...actual, V2_OPERATIONS: { ...actual.V2_OPERATIONS, updateTable: operation } }
})

import { addOperationOptions } from '#sim-cli/runtime/options'
import { buildRequest } from '#sim-cli/runtime/request'

function request(args: string[]) {
  const command = new Command('resolve').exitOverride().configureOutput({ writeErr: () => {} })
  command.argument('<requestId>')
  addOperationOptions(command, 'updateTable', {}, operation)
  command.parse(['request', ...args], { from: 'user' })
  return buildRequest('updateTable', command.args, command.opts(), null)
}

describe('discriminated body flags', () => {
  it('builds an apply request and coerces an optional credit cap', () => {
    expect(
      request([
        '--action',
        'apply',
        '--expected-fingerprint',
        'preview',
        '--new-limit-credits',
        '100',
      ])
    ).toEqual({
      path: '/api/v2/requests/request/resolve',
      query: {},
      body: { action: 'apply', expectedFingerprint: 'preview', newLimitCredits: 100 },
    })
  })

  it('builds a decline request without requiring apply fields', () => {
    expect(request(['--action', 'decline', '--reason', 'Not needed']).body).toEqual({
      action: 'decline',
      reason: 'Not needed',
    })
  })

  it('allows an apply request without the optional credit cap', () => {
    expect(request(['--action', 'apply', '--expected-fingerprint', 'preview']).body).toEqual({
      action: 'apply',
      expectedFingerprint: 'preview',
    })
  })

  it('leaves branch defaults to the server and validates shared enum flags against the selected branch', () => {
    expect(request(['--action', 'decline', '--reason', 'No']).body).not.toHaveProperty('mode')
    expect(
      request(['--action', 'decline', '--reason', 'No', '--mode', 'manual']).body
    ).toMatchObject({ mode: 'manual' })
    expect(() => request(['--action', 'decline', '--reason', 'No', '--mode', 'automatic'])).toThrow(
      '--mode must be one of: manual'
    )
  })

  it.each([
    [['--action', 'apply'], '--expected-fingerprint is required'],
    [['--action', 'decline'], '--reason is required'],
    [
      ['--action', 'apply', '--expected-fingerprint', 'preview', '--reason', 'Unused'],
      '--reason is not available when --action is apply',
    ],
    [
      ['--action', 'decline', '--reason', 'No', '--expected-fingerprint', 'preview'],
      '--expected-fingerprint is not available when --action is decline',
    ],
    [
      ['--action', 'decline', '--reason', 'No', '--new-limit-credits', '100'],
      '--new-limit-credits is not available when --action is decline',
    ],
    [
      ['--action', 'apply', '--expected-fingerprint', 'preview', '--new-limit-credits', '1.5'],
      '--new-limit-credits must be a whole number',
    ],
  ])('refuses an invalid selected-branch request %j before sending', (args, error) => {
    expect(() => request(args)).toThrow(error)
  })

  it('rejects unknown and missing discriminator values in direct request building', () => {
    expect(() => buildRequest('updateTable', ['request'], {}, null)).toThrow('--action is required')
    expect(() => buildRequest('updateTable', ['request'], { action: 'other' }, null)).toThrow(
      '--action must be one of: apply, decline'
    )
  })

  it('advertises action choices and all branch flags without requiring opaque JSON', () => {
    const command = new Command('resolve')
    addOperationOptions(command, 'updateTable', {}, operation)
    const help = command.helpInformation()
    expect(help).toContain('--action <value>')
    expect(help).toContain('--expected-fingerprint <value>')
    expect(help).toContain('--new-limit-credits <value>')
    expect(help).toContain('--reason <value>')
    expect(help).not.toContain('--body')
  })
})
