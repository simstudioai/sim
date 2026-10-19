import { describe, expect, it } from 'vitest'
import { createDnsRecordTool } from '@/tools/cloudflare/create_dns_record'
import { deleteDnsRecordTool } from '@/tools/cloudflare/delete_dns_record'
import { updateR2BucketLifecycleTool } from '@/tools/cloudflare/update_r2_bucket_lifecycle'
import { updateRulesetRuleTool } from '@/tools/cloudflare/update_ruleset_rule'

describe('Cloudflare provider request boundaries', () => {
  it.each([undefined, null, '', '   '])(
    'rejects an R2 lifecycle replacement without explicit rules (%j)',
    (rules) => {
      const body = updateR2BucketLifecycleTool.request.body
      if (!body) throw new Error('Expected a request body')
      const wireInput = { apiKey: 'token', accountId: 'account', bucketName: 'bucket', rules }
      expect(() => Reflect.apply(body, undefined, [wireInput])).toThrow(/rules/)
    }
  )

  it.each([{ rules: [] }, { rules: '[]' }])(
    'preserves an explicit R2 lifecycle clear (%j)',
    ({ rules }) => {
      const body = updateR2BucketLifecycleTool.request.body
      if (!body) throw new Error('Expected a request body')
      expect(body({ apiKey: 'token', accountId: 'account', bucketName: 'bucket', rules })).toEqual({
        rules: [],
      })
    }
  )

  it('preserves every explicitly supplied R2 lifecycle rule', () => {
    const body = updateR2BucketLifecycleTool.request.body
    if (!body) throw new Error('Expected a request body')
    const rules = [
      {
        id: 'expire-logs',
        enabled: true,
        conditions: { prefix: 'logs/' },
        deleteObjectsTransition: { condition: { type: 'Age', maxAge: 86400 } },
      },
      {
        id: 'retain-archive-transition',
        enabled: false,
        conditions: { prefix: 'archive/' },
        storageClassTransitions: [
          { condition: { type: 'Age', maxAge: 2592000 }, storageClass: 'InfrequentAccess' },
        ],
      },
    ]
    expect(
      body({
        apiKey: 'token',
        accountId: 'account',
        bucketName: 'bucket',
        rules: JSON.stringify(rules),
      })
    ).toEqual({ rules })
  })

  it('rejects a DNS deletion identifier that would address the collection instead', () => {
    const url = deleteDnsRecordTool.request.url
    if (typeof url !== 'function') throw new Error('Expected a parameterized URL')
    expect(() => url({ apiKey: 'token', zoneId: 'zone', recordId: '..' })).toThrow(/recordId/)
  })

  it('rejects JSON null where a replacement rule requires action parameters', () => {
    const body = updateRulesetRuleTool.request.body
    if (!body) throw new Error('Expected a request body')
    expect(() =>
      body({
        apiKey: 'token',
        zoneId: 'zone',
        rulesetId: 'ruleset',
        ruleId: 'rule',
        action: 'block',
        expression: 'true',
        actionParameters: 'null',
      })
    ).toThrow(/must be a JSON object/)
  })

  it('preserves structured SRV data instead of sending an empty content value', () => {
    const body = createDnsRecordTool.request.body
    if (!body) throw new Error('Expected a request body')
    const input = {
      apiKey: 'token',
      zoneId: 'zone',
      type: 'SRV',
      name: '_sip._tcp.example.com',
      data: '{"priority":10,"weight":5,"port":5060,"target":"sip.example.com"}',
    }
    expect(body(input)).toEqual({
      type: 'SRV',
      name: '_sip._tcp.example.com',
      data: { priority: 10, weight: 5, port: 5060, target: 'sip.example.com' },
    })
  })
})
