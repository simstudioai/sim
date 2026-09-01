/**
 * Covers the Granola tool logic that is not a straight field copy: the tri-mode list parser that
 * block inputs, LLM arguments, and trigger fields all feed into, and the PATCH body builder whose
 * "omit means leave unchanged" semantics differ per field.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { updateWebhookEndpointTool } from '@/tools/granola/update_webhook_endpoint'
import { toStringList } from '@/tools/granola/utils'

const buildBody = (params: Record<string, unknown>) =>
  (updateWebhookEndpointTool.request.body as (p: never) => Record<string, unknown>)(params as never)

describe('toStringList', () => {
  it('splits a comma-separated string and trims blanks', () => {
    expect(toStringList('personal, public')).toEqual(['personal', 'public'])
    expect(toStringList('personal,,  public , ')).toEqual(['personal', 'public'])
  })

  it('parses a JSON array string', () => {
    expect(toStringList('["fol_a","fol_b"]')).toEqual(['fol_a', 'fol_b'])
  })

  it('returns an empty list for a JSON empty array, which clears a filter', () => {
    expect(toStringList('[]')).toEqual([])
  })

  it('passes an existing array through', () => {
    expect(toStringList(['fol_a', ' fol_b '])).toEqual(['fol_a', 'fol_b'])
  })

  it('splits comma-separated values nested inside an array entry', () => {
    /**
     * Trigger config can arrive array-wrapped rather than split, so a single entry may still hold
     * a comma-separated list. Without splitting here it would be sent as one malformed identifier.
     */
    expect(toStringList(['fol_a, fol_b'])).toEqual(['fol_a', 'fol_b'])
  })

  it('falls back to comma splitting when a bracketed value is not valid JSON', () => {
    expect(toStringList('[fol_a, fol_b')).toEqual(['[fol_a', 'fol_b'])
  })

  it('treats blank and non-string values as empty', () => {
    expect(toStringList('')).toEqual([])
    expect(toStringList('   ')).toEqual([])
    expect(toStringList(undefined)).toEqual([])
    expect(toStringList(null)).toEqual([])
  })
})

describe('update webhook endpoint body', () => {
  it('omits every field that was left blank', () => {
    expect(buildBody({ webhookEndpointId: 'whe_1', apiKey: 'k' })).toEqual({})
  })

  it('sends only the fields that were supplied', () => {
    expect(
      buildBody({
        webhookEndpointId: 'whe_1',
        apiKey: 'k',
        scopes: 'personal, public',
        events: 'note.edited',
      })
    ).toEqual({
      scopes: ['personal', 'public'],
      events: ['note.edited'],
    })
  })

  it('distinguishes clearing the folder filter from leaving it unchanged', () => {
    /* "[]" is an explicit clear; blank means leave the current filter in place. */
    expect(buildBody({ webhookEndpointId: 'whe_1', folderIds: '[]' })).toEqual({ folder_ids: [] })
    expect(buildBody({ webhookEndpointId: 'whe_1', folderIds: '   ' })).toEqual({})
    expect(buildBody({ webhookEndpointId: 'whe_1', folderIds: 'fol_a' })).toEqual({
      folder_ids: ['fol_a'],
    })
  })

  it('treats the empty enabled selection as "leave unchanged"', () => {
    /**
     * The block dropdown is tri-state and seeds ''. A naive truthiness check would send
     * enabled:false and silently pause a live endpoint.
     */
    expect(buildBody({ webhookEndpointId: 'whe_1', enabled: '' })).toEqual({})
    expect(buildBody({ webhookEndpointId: 'whe_1', enabled: 'false' })).toEqual({ enabled: false })
    expect(buildBody({ webhookEndpointId: 'whe_1', enabled: 'true' })).toEqual({ enabled: true })
    expect(buildBody({ webhookEndpointId: 'whe_1', enabled: false })).toEqual({ enabled: false })
    expect(buildBody({ webhookEndpointId: 'whe_1', enabled: true })).toEqual({ enabled: true })
  })

  it('trims the endpoint id and url', () => {
    const url = (updateWebhookEndpointTool.request.url as (p: never) => string)({
      webhookEndpointId: '  whe_1  ',
    } as never)
    expect(url).toBe('https://public-api.granola.ai/v1/webhook-endpoints/whe_1')
    expect(buildBody({ webhookEndpointId: 'whe_1', url: '  https://x.test/h  ' })).toEqual({
      url: 'https://x.test/h',
    })
  })
})
