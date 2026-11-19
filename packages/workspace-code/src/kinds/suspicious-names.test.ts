/**
 * Names a reviewer reads in a workspace directory: a bidi control or zero-width character makes
 * one read differently from what it stores, so each warns and still applies, its text kept as
 * written.
 */
import { describe, expect, it } from 'vitest'
import { fileCodec } from './files'
import { knowledgeCodec } from './knowledge'
import { mcpCodec } from './mcp'
import { skillCodec } from './skills'
import { toolCodec } from './tools'

const RLO = '‮'
const ZWSP = '​'
const SHA = 'a'.repeat(64)
const HEADER = (callee: string) =>
  `// @sim-sdk 1\nimport { ${callee} } from '@sim/workflow-sdk/workspace'\n\n`

function codes(result: { diagnostics: ReadonlyArray<{ code: string }> }): string[] {
  return result.diagnostics.map((finding) => finding.code)
}

describe('names with a bidi control or zero-width character', () => {
  it('warns on a knowledge base name and keeps it', () => {
    const parsed = knowledgeCodec.parse(
      'policies',
      {
        'knowledge/policies/knowledge.ts': `${HEADER('defineKnowledgeBase')}export default defineKnowledgeBase({ name: 'Pay${RLO}out' })\n`,
      },
      []
    )
    expect(codes(parsed)).toEqual(['W_DECL_SUSPICIOUS_CHARACTER'])
    expect(parsed.decl?.name).toBe(`Pay${RLO}out`)
  })

  it('warns on a custom tool title', () => {
    const parsed = toolCodec.parse(
      'lookup',
      {
        'tools/lookup.ts': `${HEADER('defineTool')}export default defineTool({ title: 'Look${ZWSP}up', schema: { type: 'function', function: { name: 'lookup', parameters: { type: 'object', properties: {} } } }, code: 'return 1' })\n`,
      },
      []
    )
    expect(codes(parsed)).toEqual(['W_DECL_SUSPICIOUS_CHARACTER'])
    expect(parsed.decl?.title).toBe(`Look${ZWSP}up`)
  })

  it('warns on an MCP server name', () => {
    const parsed = mcpCodec.parse(
      'github',
      {
        'mcp/github.ts': `${HEADER('defineMcpServer')}export default defineMcpServer({ name: 'Git${RLO}Hub', url: 'https://mcp.example.com' })\n`,
      },
      []
    )
    expect(codes(parsed)).toEqual(['W_DECL_SUSPICIOUS_CHARACTER'])
    expect(parsed.decl?.name).toBe(`Git${RLO}Hub`)
  })

  it('warns on a skill name, and not on its description', () => {
    const parsed = skillCodec.parse(
      'tone',
      { 'skills/tone.md': `---\nname: to${ZWSP}ne\ndescription: a${ZWSP}b\n---\nBody\n` },
      []
    )
    expect(codes(parsed)).toEqual(['W_DECL_SUSPICIOUS_CHARACTER'])
    expect(parsed.diagnostics[0]?.span?.line).toBe(2)
    expect(parsed.decl?.name).toBe(`to${ZWSP}ne`)
  })

  it('warns on a workspace file path and keeps the file', () => {
    const path = `files/invoice${RLO}fdp.exe`
    const grouped = fileCodec.group([path])
    expect(codes(grouped)).toEqual(['W_DECL_SUSPICIOUS_CHARACTER'])
    expect([...grouped.groups.keys()]).toEqual([`invoice${RLO}fdp.exe`])
  })

  it('warns on a knowledge document name and keeps the document', () => {
    const doc = `knowledge/policies/docs/invoice${RLO}fdp.txt`
    const parsed = knowledgeCodec.parse(
      'policies',
      {
        'knowledge/policies/knowledge.ts': `${HEADER('defineKnowledgeBase')}export default defineKnowledgeBase({ name: 'Policies' })\n`,
      },
      [{ path: doc, sha256: SHA, size: 3 }]
    )
    expect(codes(parsed)).toEqual(['W_DECL_SUSPICIOUS_CHARACTER'])
    expect(Object.keys(parsed.decl?.docs ?? {})).toEqual([`invoice${RLO}fdp.txt`])
  })
})
