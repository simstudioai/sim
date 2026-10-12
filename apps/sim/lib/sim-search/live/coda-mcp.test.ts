import { describe, expect, it, vi } from 'vitest'
import type { McpToolResult } from '@/lib/mcp/types'
import { type CodaMcpClient, readCodaMcp, searchCodaMcp } from '@/lib/sim-search/live/coda-mcp'
import { managedMcpPayload } from '@/lib/sim-search/live/managed-mcp-payload'

const codaMcpPayload = (result: McpToolResult) => managedMcpPayload(result, 'Coda')

const input = { query: 'launch', limit: 20, scopes: [] }

describe('Coda MCP content search', () => {
  it('accepts structured and JSON text output, and rejects tool failures', () => {
    expect(codaMcpPayload({ structuredContent: { results: [] } })).toEqual({ results: [] })
    expect(
      codaMcpPayload({ structuredContent: { toolName: 'search', result: { results: [] } } })
    ).toEqual({ results: [] })
    expect(codaMcpPayload({ content: [{ type: 'text', text: '{"results":[]}' }] })).toEqual({
      results: [],
    })
    expect(
      codaMcpPayload({
        content: [{ type: 'text', text: '{"toolName":"search","result":{"results":[]}}' }],
      })
    ).toEqual({ results: [] })
    expect(() =>
      codaMcpPayload({ isError: true, content: [{ type: 'text', text: 'secret' }] })
    ).toThrow('Coda could not complete')
    expect(() =>
      codaMcpPayload({
        isError: true,
        content: [{ type: 'text', text: "You've reached your weekly limit of 30 MCP requests." }],
      })
    ).toThrow('Coda MCP request limit reached')
  })
  it('rejects page-scoped document filters before calling the provider', async () => {
    const call = vi.fn<CodaMcpClient['call']>()
    await expect(
      searchCodaMcp(
        { call },
        { ...input, native: { provider: 'coda', query: 'term', project: 'coda://docs/d/pages/p' } }
      )
    ).rejects.toThrow('requires a document URI')
    expect(call).not.toHaveBeenCalled()
  })
  it('does not claim complete coverage for an unrecognized result shape', async () => {
    const call = vi.fn<CodaMcpClient['call']>().mockResolvedValue({ unexpected: [] })
    await expect(searchCodaMcp({ call }, input)).rejects.toThrow('unsupported result format')
  })
  it('does not send arbitrary URLs or malformed references to the server', async () => {
    const call = vi.fn<CodaMcpClient['call']>()
    await expect(readCodaMcp({ call }, 'https://evil.example/doc')).rejects.toThrow(
      'unsupported resource URI'
    )
    await expect(readCodaMcp({ call }, 'coda://docs/a/../../b')).rejects.toThrow(
      'unsupported resource URI'
    )
    expect(call).not.toHaveBeenCalled()
  })
})
