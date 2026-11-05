/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { readManagedMcpAccountIdentity } from '@/lib/credential-groups/mcp-account-identity'

const text = (value: unknown) => ({
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
    ).toEqual({ subject: 'user-1', tenant: 'workspace-1', label: 'pat@example.test' })
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
    ['a tool error', { isError: true, content: [{ type: 'text', text: 'pat@example.test' }] }],
    ['no content', { content: [] }],
    ['a response with no email', text({ name: 'Pat' })],
    ['two different emails in text', text('a@example.test and b@example.test')],
    ['a Notion response without a user', text({ workspace: { id: 'workspace-1' } })],
    ['a Notion response without a workspace', text({ user: { id: 'user-1' } })],
  ])('reports no identity for %s rather than guessing', (_name, result) => {
    const connector = _name.startsWith('a Notion') ? 'notion' : 'fireflies'
    expect(readManagedMcpAccountIdentity(connector, result)).toBeNull()
  })

  it('reports no identity for a connector with no identity tool', () => {
    expect(readManagedMcpAccountIdentity('lucid', text({ email: 'pat@example.test' }))).toBeNull()
  })
})
