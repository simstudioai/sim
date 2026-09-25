import { describe, expect, it, vi } from 'vitest'
import { createPolicyVerifier } from '@/lib/sim-search/live/policy'
import { defaultLiveSearchPolicy } from '@/lib/sim-search/live/policy-schema'
import type { NativeClient } from '@/lib/sim-search/live/types'

function client(rows: Record<string, unknown>): NativeClient {
  return {
    json: vi.fn(async (path) => {
      if (!(path in rows)) throw new Error(`Missing metadata: ${path}`)
      return rows[path]
    }),
    text: vi.fn(),
  }
}
const selected = (included: string[], excluded: string[] = []) => ({
  ...defaultLiveSearchPolicy(),
  mode: 'selected' as const,
  included,
  excluded,
})

describe('organization search scope enforcement', () => {
  it('checks current Drive ancestors and gives exclusions precedence', async () => {
    const api = client({
      '/drive/v3/files/doc': { id: 'doc', parents: ['child'] },
      '/drive/v3/files/child': { id: 'child', parents: ['root'] },
      '/drive/v3/files/root': { id: 'root' },
    })
    expect(
      await createPolicyVerifier('google_drive', selected(['root']), api, '')({ id: 'doc' })
    ).toBe(true)
    expect(
      await createPolicyVerifier(
        'google_drive',
        selected(['root'], ['child']),
        api,
        ''
      )({ id: 'doc' })
    ).toBe(false)
    expect(
      await createPolicyVerifier(
        'google_drive',
        { ...selected(['root']), includeSubfolders: false },
        api,
        ''
      )({ id: 'doc' })
    ).toBe(false)
  })
  it('rejects a moved file and does not reuse cached ancestry across requests', async () => {
    const rows = {
      '/drive/v3/files/doc': { id: 'doc', parents: ['root'] },
      '/drive/v3/files/root': { id: 'root' },
      '/drive/v3/files/outside': { id: 'outside' },
    }
    const api = client(rows)
    expect(
      await createPolicyVerifier('google_drive', selected(['root']), api, '')({ id: 'doc' })
    ).toBe(true)
    rows['/drive/v3/files/doc'].parents = ['outside']
    expect(
      await createPolicyVerifier('google_drive', selected(['root']), api, '')({ id: 'doc' })
    ).toBe(false)
  })
  it('fails closed on inaccessible or cyclic folder ancestry', async () => {
    const api = client({ '/drive/v3/files/doc': { id: 'doc', parents: ['missing'] } })
    await expect(
      createPolicyVerifier('google_drive', selected(['missing']), api, '')({ id: 'doc' })
    ).rejects.toThrow()
    expect(
      await createPolicyVerifier(
        'google_drive',
        selected(['doc']),
        client({ '/drive/v3/files/doc': { id: 'doc', parents: ['doc'] } }),
        ''
      )({ id: 'doc' })
    ).toBe(false)
  })
  it('resolves Gmail labels per mailbox and applies category exclusions', async () => {
    const api = client({
      '/gmail/v1/users/me/messages/mail': { id: 'mail', labelIds: ['Label_7', 'CATEGORY_SOCIAL'] },
      '/gmail/v1/users/me/labels': { labels: [{ id: 'Label_7', name: 'Engineering' }] },
    })
    expect(
      await createPolicyVerifier('gmail', selected(['Engineering']), api, '')({ id: 'mail' })
    ).toBe(true)
    expect(
      await createPolicyVerifier(
        'gmail',
        { ...selected(['Engineering']), excludeSocial: true },
        api,
        ''
      )({ id: 'mail' })
    ).toBe(false)
  })
  it('resolves primary calendars to each user’s calendar ID', async () => {
    const api = client({
      '/calendar/v3/users/me/calendarList/alice%40example.com': {
        id: 'alice@example.com',
        primary: true,
      },
    })
    expect(
      await createPolicyVerifier(
        'google_calendar',
        selected(['primary']),
        api,
        ''
      )({ id: 'event', container: 'alice@example.com' })
    ).toBe(true)
  })
  it('blocks Slack DMs even when the user granted DM scopes', async () => {
    const api = client({
      '/api/conversations.info': { ok: true, channel: { id: 'D123', is_im: true } },
    })
    expect(
      await createPolicyVerifier(
        'slack',
        { ...defaultLiveSearchPolicy(), includeDirectMessages: false },
        api,
        ''
      )({ id: '1.2', container: 'D123' })
    ).toBe(false)
    expect(
      await createPolicyVerifier(
        'slack',
        { ...defaultLiveSearchPolicy(), includeDirectMessages: true },
        api,
        ''
      )({ id: '1.2', container: 'D123' })
    ).toBe(true)
  })
  it('never trusts an unscoped Slack file under channel restrictions', async () => {
    expect(
      await createPolicyVerifier(
        'slack',
        selected(['C123']),
        client({ '/api/files.info': { ok: true, file: { id: 'F123' } } }),
        ''
      )({ id: 'F123', kind: 'file' })
    ).toBe(false)
  })
  it('rejects GitHub native-query scope widening and sibling path prefixes', async () => {
    const verify = createPolicyVerifier(
      'github',
      { ...selected(['org/repo']), pathPrefixes: ['src'] },
      client({}),
      ''
    )
    expect(await verify({ id: 'src/auth.ts', kind: 'code', container: 'org/repo' })).toBe(true)
    expect(await verify({ id: 'src-other/auth.ts', kind: 'code', container: 'org/repo' })).toBe(
      false
    )
    expect(await verify({ id: 'src/../private.ts', kind: 'code', container: 'org/repo' })).toBe(
      false
    )
    expect(await verify({ id: 'src/./auth.ts', kind: 'code', container: 'org/repo' })).toBe(false)
    expect(await verify({ id: 'src/auth.ts', kind: 'code', container: 'public/unrelated' })).toBe(
      false
    )
  })
  it('binds GitLab project IDs and paths to the approved host including port', async () => {
    const policy = { ...selected(['team/repo']), sites: ['gitlab.company.test:8443'] }
    const api = client({ '/api/v4/projects/42': { id: 42, path_with_namespace: 'team/repo' } })
    expect(
      await createPolicyVerifier(
        'gitlab',
        policy,
        api,
        'https://gitlab.company.test:8443'
      )({ id: 'src/a', container: '42', kind: 'code' })
    ).toBe(true)
    expect(
      await createPolicyVerifier(
        'gitlab',
        policy,
        api,
        'https://gitlab.com'
      )({ id: 'src/a', container: '42' })
    ).toBe(false)
  })
  it.each(['jira', 'confluence'] as const)(
    'verifies canonical %s project/space metadata',
    async (provider) => {
      const api = client({
        '/ex/jira/site/rest/api/3/issue/ENG-2': { fields: { project: { key: 'ENG' } } },
        '/ex/confluence/site/wiki/rest/api/content/ENG-2': { space: { key: 'ENG' } },
      })
      expect(
        await createPolicyVerifier(
          provider,
          selected(['ENG']),
          api,
          ''
        )({ id: 'ENG-2', container: 'site' })
      ).toBe(true)
      expect(
        await createPolicyVerifier(
          provider,
          selected(['HR']),
          api,
          ''
        )({ id: 'ENG-2', container: 'site' })
      ).toBe(false)
    }
  )
  it('checks Coda page and row document IDs, including converted URLs', async () => {
    const mcp = { call: vi.fn(async () => ({ docUri: 'coda://docs/allowed' })) }
    const verify = createPolicyVerifier('coda', selected(['allowed']), null, '', mcp)
    expect(await verify({ id: 'coda://docs/allowed/tables/table/rows/row' })).toBe(true)
    expect(await verify({ id: 'superhuman://docs/allowed/pages/section-page#Title' })).toBe(true)
    expect(await verify({ id: 'coda://docs/other/pages/page' })).toBe(false)
    expect(await verify({ id: 'https://coda.io/d/doc' })).toBe(true)
    expect(mcp.call).toHaveBeenCalledWith('url_convert', {
      action: 'decode',
      url: 'https://coda.io/d/doc',
      scope: 'document',
    })
    expect(await verify({ id: 'https://coda.io:444/d/doc' })).toBe(false)
    expect(await verify({ id: 'https://evil.test/d/doc' })).toBe(false)
  })
})
