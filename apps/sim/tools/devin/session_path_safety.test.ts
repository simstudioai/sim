import { describe, expect, it } from 'vitest'
import { devinTerminateSessionTool } from '@/tools/devin/terminate_session'

const base = { apiKey: 'k', orgId: 'org_1' }

function terminateUrl(sessionId: string, orgId = base.orgId): string {
  const url = devinTerminateSessionTool.request.url
  if (typeof url !== 'function') throw new Error('expected a url builder')
  return url({ ...base, orgId, sessionId })
}

describe('Devin session path segments', () => {
  it.each(['..', '.', ' .. '])('rejects session id %j before a DELETE can climb the path', (id) => {
    expect(() => terminateUrl(id)).toThrow(/sessionId/)
  })

  it('rejects an organization id of ..', () => {
    expect(() => terminateUrl('devin-1', '..')).toThrow(/orgId/)
  })

  it('rejects a session id containing a path separator', () => {
    expect(() => terminateUrl('devin-1/../../x')).toThrow(/sessionId/)
  })

  it('leaves ordinary ids unchanged', () => {
    expect(terminateUrl(' devin-abc123 ')).toBe(
      'https://api.devin.ai/v3/organizations/org_1/sessions/devin-abc123'
    )
  })
})
