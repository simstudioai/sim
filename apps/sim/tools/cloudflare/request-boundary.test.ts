import { describe, expect, it } from 'vitest'
import { createDnsRecordTool } from '@/tools/cloudflare/create_dns_record'
import { deleteDnsRecordTool } from '@/tools/cloudflare/delete_dns_record'
import { updateRulesetRuleTool } from '@/tools/cloudflare/update_ruleset_rule'

describe('Cloudflare provider request boundaries', () => {
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
