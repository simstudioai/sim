import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { type McpHeaderDecl, type McpServerDecl, mcpCodec } from './mcp'

const text = fc
  .string({ maxLength: 20 })
  .filter((value) => !/[\u0000\r\n\ud800-\udfff]/.test(value))
const envName = fc.stringMatching(/^[A-Z_][A-Z0-9_]{0,8}$/)
/** A header name no credential pattern matches, so any text is a fine value. */
const plainHeader = fc.constantFrom('Accept', 'X-Team', 'X-Org', 'User-Agent')
const credentialHeader = fc.constantFrom('Authorization', 'X-Api-Key', 'X-Auth-Token')

const plainValue: fc.Arbitrary<McpHeaderDecl> = fc.oneof(
  text,
  envName.map((name) => `{{${name}}}`),
  fc.constant({ stored: null })
)
const credentialValue: fc.Arbitrary<McpHeaderDecl> = fc.oneof(
  envName.map((name) => `{{${name}}}`),
  envName.map((name) => `Bearer {{${name}}}`),
  fc.constant({ stored: null })
)

const server: fc.Arbitrary<McpServerDecl> = fc.record(
  {
    name: text.filter((value) => value.length > 0),
    description: text.filter((value) => value.length > 0),
    url: fc.constantFrom('https://mcp.example.com/mcp', 'http://127.0.0.1:3000/mcp'),
    transport: fc.constant('streamable-http' as const),
    headers: fc
      .tuple(
        fc.dictionary(plainHeader, plainValue, { maxKeys: 2 }),
        fc.dictionary(credentialHeader, credentialValue, { maxKeys: 2 })
      )
      .map(([plain, credential]) => ({ ...plain, ...credential })),
    auth: fc.oneof(
      fc.record({ type: fc.constantFrom('none' as const, 'headers' as const) }),
      fc.record({ type: fc.constant('oauth' as const), clientId: text })
    ),
    timeout: fc.integer({ min: 1, max: 600_000 }),
    retries: fc.integer({ min: 0, max: 10 }),
    enabled: fc.boolean(),
  },
  { requiredKeys: ['name', 'url'] }
)

function declaration(
  body: string,
  imports = 'defineMcpServer, env, stored'
): Record<string, string> {
  return {
    'mcp/github.ts': `// @sim-sdk 1\nimport { ${imports} } from '@sim/workflow-sdk/workspace'\n\nexport default defineMcpServer(${body})\n`,
  }
}

function parse(body: string, imports?: string) {
  return mcpCodec.parse('github', declaration(body, imports), [])
}

function errorCodes(body: string, imports?: string): string[] {
  return parse(body, imports)
    .diagnostics.filter((finding) => finding.severity === 'error')
    .map((finding) => finding.code)
}

describe('mcpCodec', () => {
  it('reads back every server it prints, byte-stable', () => {
    fc.assert(
      fc.property(server, (decl) => {
        const printed = mcpCodec.print('github', decl)
        const parsed = mcpCodec.parse('github', printed.text, [])
        expect(parsed.diagnostics).toEqual([])
        expect(parsed.decl).toEqual(decl)
        if (parsed.decl) expect(mcpCodec.print('github', parsed.decl)).toEqual(printed)
      }),
      { numRuns: 300 }
    )
  })

  it('reads env members, env tokens and stored() as the stored header text', () => {
    const parsed = parse(
      `{ url: 'https://mcp.example.com', headers: { 'X-Api-Key': env.GH_KEY, Authorization: 'Bearer {{GH_TOKEN}}', Cookie: stored() } }`
    )
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.decl?.headers).toEqual({
      'X-Api-Key': '{{GH_KEY}}',
      Authorization: 'Bearer {{GH_TOKEN}}',
      Cookie: { stored: null },
    })
    expect(parsed.decl?.name).toBe('github')
  })

  it('prints a whole env reference as env.NAME and a kept value as stored()', () => {
    const printed = mcpCodec.print('github', {
      name: 'GitHub',
      url: 'https://mcp.example.com',
      headers: { 'X-Api-Key': '{{GH_KEY}}', Authorization: { stored: 'abc' } },
    }).text['mcp/github.ts']
    expect(printed).toContain("'X-Api-Key': env.GH_KEY")
    expect(printed).toContain('Authorization: stored()')
    expect(printed).toContain(
      "import { defineMcpServer, env, stored } from '@sim/workflow-sdk/workspace'"
    )
    expect(printed).not.toContain('abc')
  })

  it('refuses a literal secret in a credential header', () => {
    expect(
      errorCodes(`{ url: 'https://mcp.example.com', headers: { Authorization: 'Bearer ghp_123' } }`)
    ).toEqual(['E_MCP_LITERAL_SECRET'])
    expect(
      errorCodes(`{ url: 'https://mcp.example.com', headers: { 'X-Api-Key': 'sk-live' } }`)
    ).toEqual(['E_MCP_LITERAL_SECRET'])
  })

  it('accepts every auth scheme a workflow credential header accepts before an env reference', () => {
    for (const scheme of ['Bearer', 'Basic', 'Token', 'Bot', 'Digest', 'ApiKey', 'Key']) {
      expect(
        errorCodes(
          `{ url: 'https://mcp.example.com', headers: { Authorization: '${scheme} {{GH_TOKEN}}' } }`
        )
      ).toEqual([])
    }
  })

  it('refuses a known token format in a header whose name carries no credential', () => {
    expect(
      errorCodes(
        `{ url: 'https://mcp.example.com', headers: { 'X-Upstream': 'ghp_${'a'.repeat(36)}' } }`
      )
    ).toEqual(['E_MCP_LITERAL_SECRET'])
  })

  it('keeps literal text in a header that carries no credential', () => {
    expect(
      errorCodes(`{ url: 'https://mcp.example.com', headers: { Accept: 'application/json' } }`)
    ).toEqual([])
  })

  it('refuses a malformed declaration', () => {
    expect(errorCodes(`{ name: 'GitHub' }`)).toEqual(['E_DECL_SHAPE'])
    expect(errorCodes(`{ url: 'ftp://mcp.example.com' }`)).toEqual(['E_DECL_SHAPE'])
    expect(errorCodes(`{ url: 'https://a.example', transport: 'sse' }`)).toEqual(['E_DECL_SHAPE'])
    expect(errorCodes(`{ url: 'https://a.example', timeout: 0 }`)).toEqual(['E_DECL_SHAPE'])
    expect(errorCodes(`{ url: 'https://a.example', token: 'x' }`)).toEqual(['E_DECL_UNKNOWN_FIELD'])
    expect(
      errorCodes(`{ url: 'https://a.example', auth: { type: 'headers', clientId: 'c' } }`)
    ).toEqual(['E_DECL_SHAPE'])
    expect(
      errorCodes(`{ url: 'https://a.example', headers: { Accept: 'a', accept: 'b' } }`)
    ).toEqual(['E_DECL_SHAPE'])
    expect(errorCodes(`{ url: 'https://a.example', headers: { Accept: stored(1) } }`)).toEqual([
      'E_DECL_SHAPE',
    ])
  })

  it('refuses headers written as one env reference or helper call instead of an object', () => {
    for (const headers of ['env.GITHUB_TOKEN', 'stored()']) {
      const parsed = parse(`{ url: 'https://a.example', headers: ${headers} }`)
      expect(parsed.decl).toBeUndefined()
      expect(parsed.diagnostics).toMatchObject([
        { code: 'E_DECL_SHAPE', message: expect.stringContaining('headers must be an object') },
      ])
    }
  })

  it('refuses env without its import and any other member read', () => {
    expect(
      errorCodes(
        `{ url: 'https://a.example', headers: { 'X-Api-Key': env.KEY } }`,
        'defineMcpServer'
      )
    ).toEqual(['E_DECL_IMPORT'])
    expect(
      errorCodes(`{ url: 'https://a.example', headers: { 'X-Api-Key': process.env.KEY } }`)
    ).toEqual(['E_DECL_UNSUPPORTED'])
  })

  it('fingerprints an undeclared setting as its default', () => {
    const fingerprint = (decl: McpServerDecl) => JSON.stringify(mcpCodec.canonical(decl))
    const bare: McpServerDecl = { name: 'GitHub', url: 'https://a.example' }
    expect(fingerprint(bare)).toBe(
      fingerprint({
        ...bare,
        transport: 'streamable-http',
        headers: {},
        auth: { type: 'headers' },
        timeout: 30_000,
        retries: 3,
        enabled: true,
      })
    )
  })
})
