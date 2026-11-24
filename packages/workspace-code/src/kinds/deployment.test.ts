import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { fingerprintOf } from '../fingerprint'
import {
  CHAT_DEFAULT_CUSTOMIZATIONS,
  type ChatAuthDecl,
  type DeploymentDecl,
  deploymentCodec,
} from './deployment'

const text = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((value) => !/[\u0000\ud800-\udfff]/.test(value))
const envName = fc.stringMatching(/^[A-Z_][A-Z0-9_]{0,10}$/)

const auth: fc.Arbitrary<ChatAuthDecl> = fc.oneof(
  fc.constant('public' as const),
  fc.record({ password: fc.oneof(fc.constant('stored' as const), fc.record({ env: envName })) }),
  fc.record({ emails: fc.array(text, { maxLength: 3 }) }),
  fc.record({ sso: fc.array(text, { maxLength: 3 }) })
)

const deployment: fc.Arbitrary<DeploymentDecl> = fc.record(
  {
    live: fc.constantFrom('draft' as const, 'pinned' as const),
    api: fc.record({ public: fc.boolean() }, { requiredKeys: [] }),
    chat: fc.record(
      {
        identifier: text,
        title: text,
        description: text,
        auth,
        outputs: fc.array(fc.record({ block: text, path: text }), { maxLength: 3 }),
        customizations: fc.record(
          { primaryColor: text, welcomeMessage: text, imageUrl: text },
          { requiredKeys: [] }
        ),
        includeThinking: fc.boolean(),
        includeToolCalls: fc.boolean(),
      },
      { requiredKeys: ['identifier', 'title', 'auth'] }
    ),
  },
  { requiredKeys: ['live'] }
)

function parse(source: string) {
  return deploymentCodec.parse('support', { 'deployments/support.ts': source }, [])
}

function declaration(body: string, imports = 'defineDeployment, env, stored'): string {
  return `// @sim-sdk 1\nimport { ${imports} } from '@sim/workflow-sdk/workspace'\n\nexport default defineDeployment(${body})\n`
}

function chatWith(authSource: string): string {
  return declaration(
    `{ live: 'draft', chat: { identifier: 'a', title: 'A', auth: ${authSource} } }`
  )
}

describe('deploymentCodec', () => {
  it('reads back every declaration it prints, byte-stable', () => {
    fc.assert(
      fc.property(deployment, (decl) => {
        const printed = deploymentCodec.print('support', decl)
        const parsed = deploymentCodec.parse('support', printed.text, [])
        expect(parsed.diagnostics).toEqual([])
        expect(parsed.decl).toEqual(decl)
        if (parsed.decl) expect(deploymentCodec.print('support', parsed.decl)).toEqual(printed)
      }),
      { numRuns: 300 }
    )
  })

  it('prints a password as env.NAME and stored(), importing only what it uses', () => {
    const printed = deploymentCodec.print('support', {
      live: 'draft',
      chat: {
        identifier: 'support',
        title: 'Support',
        auth: { password: { env: 'CHAT_PASSWORD' } },
      },
    }).text['deployments/support.ts']
    expect(printed).toContain("import { defineDeployment, env } from '@sim/workflow-sdk/workspace'")
    expect(printed).toContain('auth: { password: env.CHAT_PASSWORD }')
    const kept = deploymentCodec.print('support', {
      live: 'pinned',
      chat: { identifier: 'support', title: 'Support', auth: { password: 'stored' } },
    }).text['deployments/support.ts']
    expect(kept).toContain('password: stored()')
    expect(kept).toContain('defineDeployment, stored }')
  })

  it('refuses a password written as a value, pinned to its line', () => {
    const parsed = parse(chatWith("{ password: 'hunter2' }"))
    expect(parsed.decl).toBeUndefined()
    expect(parsed.diagnostics.map((finding) => finding.code)).toEqual(['E_DEPLOY_SECRET'])
    expect(parsed.diagnostics[0].span?.line).toBe(4)
  })

  it('refuses env without its import, and env outside a password', () => {
    expect(
      parse(
        chatWith('{ password: env.PW }').replace(
          'defineDeployment, env, stored',
          'defineDeployment'
        )
      ).diagnostics.map((finding) => finding.code)
    ).toEqual(['E_DECL_IMPORT'])
    expect(
      parse(
        declaration("{ live: 'draft', chat: { identifier: env.ID, title: 'A', auth: 'public' } }")
      ).diagnostics.map((finding) => finding.code)
    ).toEqual(['E_DECL_SHAPE'])
    expect(
      parse(chatWith('{ password: env["PW"] }')).diagnostics.map((finding) => finding.code)
    ).toEqual(['E_DECL_UNSUPPORTED'])
  })

  it('refuses an unknown live mode, auth mode and output shape', () => {
    expect(parse(declaration("{ live: 'latest' }")).diagnostics.map((f) => f.code)).toEqual([
      'E_DECL_SHAPE',
    ])
    expect(parse(declaration('{}')).diagnostics.map((f) => f.code)).toEqual(['E_DECL_SHAPE'])
    expect(parse(chatWith("{ oauth: ['a'] }")).diagnostics.map((f) => f.code)).toEqual([
      'E_DECL_SHAPE',
    ])
    expect(
      parse(
        declaration(
          "{ live: 'draft', chat: { identifier: 'a', title: 'A', auth: 'public', outputs: [{ block: 'Answer' }] } }"
        )
      ).diagnostics.map((f) => f.code)
    ).toEqual(['E_DECL_SHAPE'])
  })

  it('fingerprints spelled-out defaults like undeclared ones', () => {
    const fingerprint = (decl: DeploymentDecl) => fingerprintOf(deploymentCodec.canonical(decl))
    const chat = { identifier: 'a', title: 'A', auth: 'public' as const }
    expect(fingerprint({ live: 'draft', chat })).toBe(
      fingerprint({
        live: 'pinned',
        api: { public: false },
        chat: {
          ...chat,
          description: '',
          outputs: [],
          customizations: { ...CHAT_DEFAULT_CUSTOMIZATIONS },
          includeThinking: false,
          includeToolCalls: false,
        },
      })
    )
    expect(fingerprint({ live: 'draft' })).not.toBe(fingerprint({ live: 'draft', chat }))
  })

  it('groups one file per workflow key and refuses anything else', () => {
    const grouped = deploymentCodec.group([
      'deployments/support.ts',
      'deployments/nested/a.ts',
      'deployments/Bad.ts',
      'deployments/readme.md',
    ])
    expect([...grouped.groups.keys()]).toEqual(['support'])
    expect(grouped.diagnostics.map((finding) => finding.code)).toEqual([
      'E_DECL_UNKNOWN_FILE',
      'E_KEY_INVALID',
      'E_DECL_UNKNOWN_FILE',
    ])
  })
})
