import { describe, expect, it } from 'vitest'
import type { WorkspaceDiagnostic } from '../diagnostics'
import { deploymentCodec } from './deployment'
import { mcpCodec } from './mcp'
import { toolCodec } from './tools'

/** A token shape the secret detector flags, built from parts so no scanner trips on the test. */
const SECRET = ['gh', 'p_', 'Zx9'.repeat(12)].join('')
const HEADER = '// @sim-sdk 1\n'

/** Every text a finding carries that reaches the API, an agent, or a log. */
function echoed(findings: readonly WorkspaceDiagnostic[]): string {
  return findings
    .map((finding) => [finding.message, finding.hint, finding.frame].join('\n'))
    .join('\n')
}

describe('findings about a literal secret', () => {
  it('never echo an MCP header secret, even once the file hits its finding cap', () => {
    const headers = Array.from(
      { length: 101 },
      (_, i) => `'X-Api-Key-${i}': 'Bearer ${SECRET}'`
    ).join(',\n    ')
    const source = `${HEADER}import { defineMcpServer } from '@sim/workflow-sdk/workspace'\n\nexport default defineMcpServer({\n  name: 'Docs',\n  url: 'https://mcp.example.com/mcp',\n  headers: {\n    Authorization: 'Bearer ${SECRET}',\n    ${headers},\n  },\n})\n`
    const parsed = mcpCodec.parse('docs', { 'mcp/docs.ts': source }, [])
    const codes = new Set(parsed.diagnostics.map((finding) => finding.code))
    expect(codes).toEqual(new Set(['E_MCP_LITERAL_SECRET', 'I_FINDINGS_TRUNCATED']))
    expect(parsed.diagnostics[0].span).toMatchObject({ file: 'mcp/docs.ts', line: 8 })
    expect(echoed(parsed.diagnostics)).not.toContain(SECRET)
  })

  it('never echo a chat password written as text', () => {
    const source = `${HEADER}import { defineDeployment } from '@sim/workflow-sdk/workspace'\n\nexport default defineDeployment({ live: 'draft', chat: { identifier: 'a', title: 'A', auth: { password: '${SECRET}' } } })\n`
    const parsed = deploymentCodec.parse('support', { 'deployments/support.ts': source }, [])
    expect(parsed.diagnostics.map((finding) => finding.code)).toContain('E_DEPLOY_SECRET')
    expect(echoed(parsed.diagnostics)).not.toContain(SECRET)
  })

  it('never echo a credential in inline custom tool code', () => {
    const source = `${HEADER}import { defineTool } from '@sim/workflow-sdk/workspace'\n\nexport default defineTool({\n  title: 'Lookup',\n  schema: { type: 'function', function: { name: 'lookup', parameters: { type: 'object', properties: {} } } },\n  code: 'return fetch(url, { headers: { Authorization: "Bearer ${SECRET}" } })',\n})\n`
    const parsed = toolCodec.parse('lookup', { 'tools/lookup.ts': source }, [])
    expect(parsed.diagnostics.map((finding) => finding.code)).toContain('W_TOOL_LITERAL_SECRET')
    expect(echoed(parsed.diagnostics)).not.toContain(SECRET)
  })
})
