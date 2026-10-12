import { describe, expect, it } from 'vitest'
import { NativeSearchError } from '@/lib/sim-search/live/http'
import type { ManagedSearchMcpClient } from '@/lib/sim-search/live/managed-mcp'
import { readNotionMcp, searchNotionMcp } from '@/lib/sim-search/live/notion-mcp'

const ID = 'a718489d-20d7-48bc-a895-a20e70374644'
const URL = `https://www.notion.so/${ID.replaceAll('-', '')}`
const input = { query: 'launch decision', limit: 10, scopes: [] }
const result = {
  id: ID,
  url: URL,
  title: 'Launch decision',
  highlight: 'Launch was postponed.',
  type: 'page',
  last_edited_time: '2026-09-20T12:00:00Z',
}

/** Failure modes: plan routing, connected-source leakage, fabricated dates, invalid references, truncation, and schema drift. */
describe('Notion live MCP boundary', () => {
  it('preserves official app.notion.com references from live keyword search through fetch', async () => {
    const url = `https://app.notion.com/p/${ID.replaceAll('-', '')}?pvs=204`
    const client: ManagedSearchMcpClient = {
      call: async (name) => {
        if (name === 'notion-get-tool-access')
          return {
            current_tool_access: {
              search: { status: 'available' },
              ai_search: { status: 'plan_required' },
            },
          }
        if (name === 'notion-search')
          return { type: 'workspace_search', results: [{ ...result, url }] }
        if (name === 'notion-fetch')
          return {
            metadata: { type: 'page' },
            title: result.title,
            url,
            text: '<page><content>Use staged rollout.</content></page>',
            page_last_edited_at: result.last_edited_time,
          }
        throw new Error('Unexpected Notion tool')
      },
    }
    const page = await searchNotionMcp(client, input)
    expect(page.documents).toHaveLength(1)
    const document = await readNotionMcp(client, page.documents[0].id)
    expect(document).toMatchObject({
      id: ID,
      url,
      title: result.title,
      modifiedAt: result.last_edited_time,
    })
    expect(document.content).toContain('Use staged rollout.')
  })

  it('hydrates dated matches from page metadata instead of using an ambiguous search timestamp', async () => {
    const client: ManagedSearchMcpClient = {
      call: async (name) => {
        if (name === 'notion-get-tool-access')
          return { current_tool_access: { ai_search: { status: 'available' } } }
        if (name === 'notion-ai-search')
          return {
            type: 'ai_search',
            results: [
              { ...result, last_edited_time: undefined, timestamp: '2026-08-01T00:00:00Z' },
            ],
          }
        if (name === 'notion-fetch')
          return {
            id: ID,
            url: URL,
            title: result.title,
            text: 'Current authoritative body',
            page_last_edited_at: result.last_edited_time,
          }
        throw new Error('Unexpected tool')
      },
    }
    const page = await searchNotionMcp(client, {
      ...input,
      filters: { startDate: '2026-09-01T00:00:00Z' },
    })
    expect(page.documents[0].modifiedAt).toBe(result.last_edited_time)
    expect(page.partial).toBe(true)
  })

  it('bounds date hydration and does not expose stale snippets when a page disappears', async () => {
    const results = Array.from({ length: 15 }, (_, index) => {
      const id = `a718489d-20d7-48bc-a895-${String(index).padStart(12, '0')}`
      return { ...result, id, url: `https://www.notion.so/${id.replaceAll('-', '')}` }
    })
    let reads = 0
    const client: ManagedSearchMcpClient = {
      call: async (name, args) => {
        if (name === 'notion-get-tool-access')
          return { current_tool_access: { search: { status: 'available' } } }
        if (name === 'notion-search') return { results }
        if (++reads > 10) throw new Error('Hydration exceeded the bounded read budget')
        if (args.id === results[0].id)
          throw new NativeSearchError('unavailable', 'Page no longer exists')
        return { id: args.id, text: 'Current page', page_last_edited_at: result.last_edited_time }
      },
    }
    const page = await searchNotionMcp(client, {
      ...input,
      limit: 20,
      filters: { startDate: '2026-09-01T00:00:00Z' },
    })
    expect(page.documents).toHaveLength(9)
    expect(page.documents.some((document) => document.id === results[0].id)).toBe(false)
    expect(page).toMatchObject({ partial: true, hasMore: true })
    expect(page.nextCursor).toBeUndefined()
  })

  it('fails a dated search if the connection loses access during hydration', async () => {
    const client: ManagedSearchMcpClient = {
      call: async (name) => {
        if (name === 'notion-get-tool-access')
          return { current_tool_access: { search: { status: 'available' } } }
        if (name === 'notion-search') return { results: [result] }
        throw new NativeSearchError('reconnect', 'Grant revoked')
      },
    }
    await expect(
      searchNotionMcp(client, { ...input, filters: { startDate: '2026-09-01T00:00:00Z' } })
    ).rejects.toMatchObject({ status: 'reconnect' })
  })

  it('uses the advertised AI route and retains only Notion resources from unified results', async () => {
    const client: ManagedSearchMcpClient = {
      call: async (name) => {
        if (name === 'notion-get-tool-access')
          return { current_tool_access: { ai_search: { status: 'available' } } }
        if (name === 'notion-ai-search')
          return {
            type: 'ai_search',
            results: [
              result,
              {
                id: 'mail',
                title: 'Private email',
                url: 'https://mail.google.com/mail/u/0/#inbox/123',
                highlight: 'external secret',
              },
            ],
          }
        throw new Error('Unadvertised tool')
      },
    }
    const page = await searchNotionMcp(client, input)
    expect(page.documents).toHaveLength(1)
    expect(page.documents[0]).toMatchObject({ id: ID, content: 'Launch was postponed.', url: URL })
    expect(page.partial).toBe(true)
  })

  it('keeps AI search coverage partial when the result omits its search type', async () => {
    const client: ManagedSearchMcpClient = {
      call: async (name) =>
        name === 'notion-get-tool-access'
          ? { current_tool_access: { ai_search: { status: 'available' } } }
          : { results: [result] },
    }
    expect(await searchNotionMcp(client, input)).toMatchObject({ partial: true })
  })

  it('uses keyword search when AI access needs an upgrade without inventing unknown timestamps', async () => {
    const client: ManagedSearchMcpClient = {
      call: async (name) => {
        if (name === 'notion-get-tool-access')
          return {
            current_tool_access: {
              search: { status: 'available' },
              ai_search: { status: 'upgrade_required' },
            },
          }
        if (name === 'notion-search')
          return {
            type: 'workspace_search',
            results: [
              { ...result, last_edited_time: undefined, timestamp: '2026-09-01T00:00:00Z' },
            ],
          }
        throw new Error('Wrong plan route')
      },
    }
    expect((await searchNotionMcp(client, input)).documents[0].modifiedAt).toBeUndefined()
  })

  it('does not interpret unavailable plan access or malformed results as no matches', async () => {
    const denied: ManagedSearchMcpClient = {
      call: async () => ({ current_tool_access: { ai_search: { status: 'not_enabled' } } }),
    }
    await expect(searchNotionMcp(denied, input)).rejects.toThrow('unavailable')
    const malformed: ManagedSearchMcpClient = {
      call: async (name) =>
        name === 'notion-get-tool-access'
          ? { current_tool_access: { search: { status: 'available' } } }
          : { pages: [] },
    }
    await expect(searchNotionMcp(malformed, input)).rejects.toThrow('unsupported')
  })

  it('reports provider notices and result caps instead of claiming full search coverage', async () => {
    const client: ManagedSearchMcpClient = {
      call: async (name) =>
        name === 'notion-get-tool-access'
          ? { current_tool_access: { search: { status: 'available' } } }
          : {
              results: [
                result,
                {
                  ...result,
                  id: '7b6fdd81-86d1-4ad3-95ed-49c931d22245',
                  url: 'https://www.notion.so/7b6fdd8186d14ad395ed49c931d22245',
                },
              ],
              notices: [{ type: 'ignored_filter' }],
            },
    }
    const page = await searchNotionMcp(client, { ...input, limit: 1 })
    expect(page.documents).toHaveLength(1)
    expect(page).toMatchObject({ partial: true, hasMore: true })
    expect(page.message).toContain('notice')
  })

  it('keeps coverage partial when the provider fills the requested page without a total or cursor', async () => {
    const client: ManagedSearchMcpClient = {
      call: async (name) =>
        name === 'notion-get-tool-access'
          ? { current_tool_access: { search: { status: 'available' } } }
          : { type: 'workspace_search', results: [result] },
    }
    const page = await searchNotionMcp(client, { ...input, limit: 1 })
    expect(page.partial).toBe(true)
    expect(page.nextCursor).toBeUndefined()
    expect(page.message).toContain('Narrow the query')
  })

  it('rejects arbitrary URLs before a fetch and does not treat a Notion link inside a title as identity', async () => {
    const client: ManagedSearchMcpClient = {
      call: async () => {
        throw new Error('Should not reach the provider')
      },
    }
    await expect(readNotionMcp(client, 'https://notion.so.evil.example/page')).rejects.toThrow(
      'Notion resource'
    )
    await expect(
      readNotionMcp(client, 'https://user:pass@www.notion.so/a718489d20d748bca895a20e70374644')
    ).rejects.toThrow('Notion resource')
    for (const host of ['app.notion.com.evil.example', 'app.notion.com:444'])
      await expect(
        readNotionMcp(client, `https://${host}/p/a718489d20d748bca895a20e70374644`)
      ).rejects.toThrow('Notion resource')
  })

  it('keeps truncation visible and reads explicit page metadata without executing linked content', async () => {
    const client: ManagedSearchMcpClient = {
      call: async () => ({
        id: ID,
        url: URL,
        title: result.title,
        page_last_edited_at: result.last_edited_time,
        text: '<content>Use staged rollout.</content>',
        truncated: true,
        unknown_block_count: 2,
      }),
    }
    const document = await readNotionMcp(client, ID)
    expect(document.content).toContain('Use staged rollout.')
    expect(document.content).toContain('incomplete')
    expect(document.modifiedAt).toBe(result.last_edited_time)
  })

  it('refuses mismatched fetched identity and malformed content', async () => {
    await expect(
      readNotionMcp(
        {
          call: async () => ({
            id: '7b6fdd81-86d1-4ad3-95ed-49c931d22245',
            url: 'https://www.notion.so/7b6fdd8186d14ad395ed49c931d22245',
            text: 'wrong page',
          }),
        },
        ID
      )
    ).rejects.toThrow('identity')
    await expect(
      readNotionMcp({ call: async () => ({ error: 'object_not_found' }) }, ID)
    ).rejects.toThrow('readable')
  })
})
