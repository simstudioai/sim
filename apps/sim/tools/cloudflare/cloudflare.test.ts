/**
 * @vitest-environment node
 *
 * Guards the per-operation subBlock defaults in the Cloudflare block.
 *
 * SubBlock initial values are seeded into block state keyed by subBlock id
 * (`stores/workflows/utils.ts` and `lib/workflows/defaults.ts` both assign
 * `subBlocks[subBlock.id] = ...` in a plain forEach), so two controls sharing an
 * id leave a single stored value and the LAST definition in file order wins.
 * These tests assert the seeded default reaching each tool for operations whose
 * control is deliberately not last, so re-introducing a collision goes red.
 */
import { describe, expect, it } from 'vitest'
import { CloudflareBlock } from '@/blocks/blocks/cloudflare'

const apiKey = 'cf-token'

const mapParams = CloudflareBlock.tools.config?.params

/**
 * Reproduces what the stores seed into block state: every subBlock default,
 * keyed by id, with later definitions overwriting earlier ones.
 */
function seededDefaults(): Record<string, unknown> {
  const seeded: Record<string, unknown> = {}
  for (const subBlock of CloudflareBlock.subBlocks) {
    if (typeof subBlock.value === 'function') {
      seeded[subBlock.id] = (subBlock.value as (p: Record<string, never>) => unknown)({})
    }
  }
  return seeded
}

function mapFor(operation: string, extra: Record<string, unknown> = {}) {
  return mapParams?.({
    ...seededDefaults(),
    apiKey,
    operation,
    ...extra,
  } as never) as Record<string, unknown>
}

describe('subBlock ids that share a tool param keep their own default', () => {
  it('does not leak the Access application type onto DNS record creation', () => {
    // The Access "Application Type" control is defined after every DNS type
    // control, so a shared id would seed create_dns_record with self_hosted.
    const mapped = mapFor('create_dns_record', {
      zoneId: 'zone1',
      name: 'www.example.com',
      content: '203.0.113.10',
    })

    expect(mapped.type).toBe('A')
    expect(mapped.type).not.toBe('self_hosted')
  })

  it('keeps the Access application type on the Access operations', () => {
    expect(mapFor('create_access_application', { accountId: 'acct1' }).type).toBe('self_hosted')
    expect(mapFor('update_access_application', { accountId: 'acct1', appId: 'app1' }).type).toBe(
      'self_hosted'
    )
  })

  it('leaves the DNS record type unset on the filter operations', () => {
    expect(mapFor('list_dns_records', { zoneId: 'zone1' }).type).toBeUndefined()
    expect(mapFor('update_dns_record', { zoneId: 'zone1', recordId: 'rec1' }).type).toBeUndefined()
  })

  it('preserves the certificate status default past the later status filters', () => {
    // list_tunnels defines the last `status` control and defaults it to empty.
    expect(mapFor('list_certificates', { zoneId: 'zone1' }).status).toBe('all')
    expect(mapFor('list_zones').status).toBeUndefined()
    expect(mapFor('list_tunnels', { accountId: 'acct1' }).status).toBeUndefined()
  })

  it('preserves the created-record proxied default past the later proxied filters', () => {
    const mapped = mapFor('create_dns_record', {
      zoneId: 'zone1',
      name: 'www.example.com',
      content: '203.0.113.10',
    })

    expect(mapped.proxied).toBe(false)
    expect(mapFor('list_dns_records', { zoneId: 'zone1' }).proxied).toBeUndefined()
  })

  it('does not seed a block action onto a WAF custom rule', () => {
    // The rate limiting action dropdown defaults to block and is defined after
    // the ruleset-rule action input; sharing an id would make every new WAF
    // custom rule silently default to blocking traffic.
    const mapped = mapFor('create_ruleset_rule', {
      zoneId: 'zone1',
      rulesetId: 'rs1',
      expression: 'true',
    })

    expect(mapped.action).toBeUndefined()
  })

  it('keeps the block default on the rate limiting operations', () => {
    expect(mapFor('create_rate_limit_rule', { zoneId: 'zone1', rulesetId: 'rs1' }).action).toBe(
      'block'
    )
    expect(
      mapFor('update_rate_limit_rule', { zoneId: 'zone1', rulesetId: 'rs1', ruleId: 'r1' }).action
    ).toBe('block')
  })

  it('strips the aliased control ids so they never reach a tool as params', () => {
    const mapped = mapFor('create_dns_record', { zoneId: 'zone1' })

    for (const alias of [
      'recordType',
      'recordProxied',
      'certificateStatus',
      'appType',
      'rateLimitAction',
      'rulesetName',
    ]) {
      expect(mapped).not.toHaveProperty(alias)
    }
  })

  it('sends the ruleset name as the name param when creating a ruleset', () => {
    const mapped = mapFor('create_ruleset', {
      zoneId: 'zone1',
      phase: 'http_ratelimit',
      rulesetName: 'Zone rate limiting ruleset',
    })

    expect(mapped.name).toBe('Zone rate limiting ruleset')
    expect(mapped).not.toHaveProperty('rulesetName')
  })
})

describe('array-valued wand fields generate arrays', () => {
  it('never asks the wand for an object where the tool parses a JSON array', () => {
    const arrayParsedIds = new Set(['include', 'exclude', 'require', 'policies', 'rules'])

    const wrong = CloudflareBlock.subBlocks.filter(
      (subBlock) =>
        arrayParsedIds.has(subBlock.id) && subBlock.wandConfig?.generationType === 'json-object'
    )

    expect(wrong.map((subBlock) => subBlock.id)).toEqual([])
  })
})

describe('no subBlock id carries two different defaults', () => {
  it('every duplicated id agrees on its seeded value', () => {
    const byId = new Map<string, Set<string>>()

    for (const subBlock of CloudflareBlock.subBlocks) {
      const value =
        typeof subBlock.value === 'function'
          ? (subBlock.value as (p: Record<string, never>) => unknown)({})
          : (subBlock.defaultValue ?? null)

      const seen = byId.get(subBlock.id) ?? new Set<string>()
      seen.add(JSON.stringify(value ?? null))
      byId.set(subBlock.id, seen)
    }

    const colliding = [...byId.entries()]
      .filter(([, values]) => values.size > 1)
      .map(([id, values]) => `${id}: ${[...values].join(' vs ')}`)

    expect(colliding).toEqual([])
  })
})
