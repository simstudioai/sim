/** @vitest-environment node */
import { writeFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolve } = vi.hoisted(() => ({ mockResolve: vi.fn() }))
const CLOUD_ID = '1324a887-45db-1bf4-1e99-ef0ff456d421'
vi.mock('@/lib/atlassian/discovery', () => ({
  resolveAtlassianCloudId: mockResolve,
  selectAtlassianCloudId: () => CLOUD_ID,
}))
import * as t from '@/tools/jira/index'

describe('probe2', () => {
  it('collects rebuild urls', async () => {
    const out: string[] = []
    for (const v of Object.values(t) as any[]) {
      if (!v || typeof v !== 'object' || typeof v.id !== 'string' || !v.transformResponse) continue
      const calls: string[] = []
      mockResolve.mockResolvedValue(CLOUD_ID)
      vi.stubGlobal('fetch', vi.fn(async (u: any) => {
        calls.push(String(u))
        return { ok: true, status: 200, statusText: 'OK', text: async () => '{}', json: async () => ({ comments: [], worklogs: [], transitions: [], issues: [], values: [], fields: {}, id: '1', key: 'PROJ' }) }
      }))
      const p: any = {}
      for (const [n, d] of Object.entries(v.params ?? {}) as any) {
        if (d.type === 'json' || d.type === 'object') p[n] = {}
        else if (d.type === 'array') p[n] = []
        else if (d.type === 'number') p[n] = 1
        else if (d.type === 'boolean') p[n] = false
        else if (n === 'orderBy') p[n] = '-created'
        else if (d.visibility === 'user-or-llm') p[n] = `TOKEN${n.toUpperCase()}TOKEN`
        else p[n] = 'inert'
      }
      p.cloudId = v.id === 'jira_bulk_read' ? CLOUD_ID : undefined
      let err = ''
      try {
        await v.transformResponse({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' }, p)
      } catch (e: any) { err = e.message }
      out.push(`${v.id} | err=${err} | ${calls.filter((c) => c.includes('/ex/jira/')).join('  ')}`)
    }
    writeFileSync('/tmp/probe2.txt', out.join('\n'))
    expect(true).toBe(true)
  })
})
