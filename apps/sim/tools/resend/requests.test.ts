import { describe, expect, it } from 'vitest'
import { resendCreateBroadcastTool } from '@/tools/resend/create_broadcast'
import { resendGetEmailTool } from '@/tools/resend/get_email'
import { resendListContactsTool } from '@/tools/resend/list_contacts'
import type { CreateBroadcastParams, ListContactsParams } from '@/tools/resend/types'

function listContactsUrl(params: Partial<ListContactsParams>): string {
  const url = resendListContactsTool.request.url
  if (typeof url !== 'function') throw new Error('list contacts url is not a builder')
  return url({ resendApiKey: 're_key', ...params })
}

function broadcastBody(params: Partial<CreateBroadcastParams>) {
  const body = resendCreateBroadcastTool.request.body
  if (!body) throw new Error('create broadcast has no body builder')
  return body({
    resendApiKey: 're_key',
    broadcastFrom: 'news@example.com',
    broadcastSubject: 'Hello',
    ...params,
  })
}

describe('Resend list pagination', () => {
  it('sends the bare collection URL when no page params are set', () => {
    expect(listContactsUrl({})).toBe('https://api.resend.com/contacts')
  })

  it('passes limit and the after cursor as query params', () => {
    expect(listContactsUrl({ limit: 100, after: ' c_123 ' })).toBe(
      'https://api.resend.com/contacts?limit=100&after=c_123'
    )
  })

  it('clamps limit to the 1-100 page size Resend accepts', () => {
    expect(listContactsUrl({ limit: 500 })).toBe('https://api.resend.com/contacts?limit=100')
    expect(listContactsUrl({ limit: 0 })).toBe('https://api.resend.com/contacts?limit=1')
    expect(listContactsUrl({ limit: 2.7 })).toBe('https://api.resend.com/contacts?limit=2')
  })

  it('drops a limit that is not a finite number', () => {
    expect(listContactsUrl({ limit: Number.NaN })).toBe('https://api.resend.com/contacts')
  })
})

describe('Resend broadcast recipients', () => {
  it('still sends audience_id for a saved workflow without a segment', () => {
    const body = broadcastBody({ audienceId: ' aud_1 ' })
    expect(body).toMatchObject({ audience_id: 'aud_1' })
    expect(body).not.toHaveProperty('segment_id')
  })

  it('sends only segment_id when a segment is given', () => {
    const body = broadcastBody({ segmentId: 'seg_1', audienceId: 'aud_1' })
    expect(body).toMatchObject({ segment_id: 'seg_1' })
    expect(body).not.toHaveProperty('audience_id')
  })

  it('refuses to build a broadcast with no recipient list', () => {
    expect(() => broadcastBody({ audienceId: '  ' })).toThrow('segment ID or audience ID')
  })
})

describe('Resend email id path segment', () => {
  it.each(['abc/cancel', '..'])('rejects %j instead of addressing another path', (emailId) => {
    const url = resendGetEmailTool.request.url
    if (typeof url !== 'function') throw new Error('get email url is not a builder')
    expect(() => url({ resendApiKey: 're_key', emailId })).toThrow()
  })
})
