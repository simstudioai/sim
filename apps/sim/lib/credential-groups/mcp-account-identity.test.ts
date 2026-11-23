/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { readManagedMcpAccountIdentity } from '@/lib/credential-groups/mcp-account-identity'
import type { McpToolResult } from '@/lib/mcp/types'

const text = (value: unknown): McpToolResult => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
})

describe('reading the connected account from a provider response', () => {
  it('uses the documented Notion user and workspace', () => {
    expect(
      readManagedMcpAccountIdentity(
        'notion',
        text({
          workspace: { id: 'workspace-1', name: 'Engineering' },
          user: { type: 'person', id: 'user-1', name: 'Pat', email: 'pat@example.test' },
        })
      )
    ).toEqual({
      subject: 'user-1',
      tenant: 'workspace-1',
      label: 'pat@example.test · Engineering',
    })
  })

  it('falls back to the workspace name for a Notion bot with no email', () => {
    expect(
      readManagedMcpAccountIdentity(
        'notion',
        text({
          workspace: { id: 'workspace-1', name: 'Engineering' },
          user: { type: 'bot', id: 'bot-1' },
        })
      )
    ).toEqual({ subject: 'bot-1', tenant: 'workspace-1', label: 'Engineering' })
  })

  it('scopes HubSpot to its account even when no user field is returned', () => {
    expect(
      readManagedMcpAccountIdentity('hubspot', {
        structuredContent: { accountId: 12345 },
      })
    ).toEqual({ subject: '12345', tenant: '12345', label: 'HubSpot account 12345' })
  })

  it.each([
    ['granola', { email: 'Pat@Example.test', workspaces: [{ name: 'One' }] }],
    ['fireflies', { user: { email: 'pat@example.test', name: 'Pat' } }],
    ['coda', { toolName: 'whoami', result: { id: 7, email: 'pat@example.test' } }],
  ])('uses the normalized email from %s JSON', (connector, payload) => {
    expect(readManagedMcpAccountIdentity(connector, text(payload))).toEqual({
      subject: 'pat@example.test',
      tenant: null,
      label: 'pat@example.test',
    })
  })

  it('reads the one email in a non-JSON response', () => {
    expect(
      readManagedMcpAccountIdentity('fireflies', text('name: Pat\nemail: pat@example.test'))
    ).toMatchObject({ subject: 'pat@example.test' })
  })

  it.each([
    ['sentence punctuation', 'Signed in as pat@example.test.', 'pat@example.test'],
    ['markdown', '**Email:** **pat@example.test**', 'pat@example.test'],
    ['a punycode domain', 'email: pat@example.xn--p1ai', 'pat@example.xn--p1ai'],
    ['a leading underscore', 'email: _pat@example.test', '_pat@example.test'],
  ])('reads a labeled email in text despite %s', (_name, value, subject) => {
    expect(readManagedMcpAccountIdentity('granola', text(value))).toMatchObject({ subject })
  })

  it.each<[string, string, McpToolResult]>([
    [
      'a tool error',
      'fireflies',
      { isError: true, content: [{ type: 'text', text: 'pat@example.test' }] },
    ],
    ['no content', 'fireflies', { content: [] }],
    ['a response with no email', 'fireflies', text({ name: 'Pat' })],
    ['two labeled emails', 'fireflies', text('email: a@example.test\nemail: b@example.test')],
    ['an email nothing names as the account', 'fireflies', text('Owner: a@example.test')],
    ['a Notion response without a user', 'notion', text({ workspace: { id: 'workspace-1' } })],
    ['a Notion response without a workspace', 'notion', text({ user: { id: 'user-1' } })],
  ])('reports no identity for %s rather than guessing', (_name, connector, result) => {
    expect(readManagedMcpAccountIdentity(connector, result)).toBeNull()
  })

  it('reports no identity for a connector with no identity tool', () => {
    expect(readManagedMcpAccountIdentity('lucid', text({ email: 'pat@example.test' }))).toBeNull()
  })
})
