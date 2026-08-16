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
import * as cloudflareTools from '@/tools/cloudflare'

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

/**
 * Returns what the tool actually receives. The executor merges the mapper's
 * output OVER the raw inputs (`finalInputs = { ...inputs, ...transformedParams }`
 * in `executor/handlers/generic/generic-handler.ts`), so a key the mapper merely
 * omits survives as its raw subBlock string. Asserting on the mapper's return
 * alone would let an alias or a stale filter through unnoticed.
 */
function mapFor(operation: string, extra: Record<string, unknown> = {}) {
  const inputs = { ...seededDefaults(), apiKey, operation, ...extra }
  return { ...inputs, ...(mapParams?.(inputs as never) as Record<string, unknown>) }
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

  it('keeps the Access application type when creating an application', () => {
    expect(mapFor('create_access_application', { accountId: 'acct1' }).type).toBe('self_hosted')
  })

  it('never seeds a type or decision onto an Access resource it is about to replace', () => {
    // Both Access updates are full replacements, so a seeded value rewrites what
    // the live resource IS as soon as anything else is edited — a policy would
    // flip from deny to allow, an application from saas to self_hosted.
    const app = mapFor('update_access_application', { accountId: 'acct1', appId: 'app1' })
    expect(app.type).toBeUndefined()
    expect(
      mapFor('update_access_application', {
        accountId: 'acct1',
        appId: 'app1',
        updateAppType: 'saas',
      }).type
    ).toBe('saas')

    const policy = mapFor('update_access_policy', { accountId: 'acct1', policyId: 'p1' })
    expect(policy.decision).toBeUndefined()
    expect(
      mapFor('update_access_policy', {
        accountId: 'acct1',
        policyId: 'p1',
        updatePolicyDecision: 'deny',
      }).decision
    ).toBe('deny')
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

  it('keeps the block default when creating a rate limiting rule', () => {
    expect(mapFor('create_rate_limit_rule', { zoneId: 'zone1', rulesetId: 'rs1' }).action).toBe(
      'block'
    )
  })

  it('never seeds an action onto a rate limiting rule it is about to replace', () => {
    // The update endpoint replaces the rule, so a seeded block would convert a
    // live log or challenge rule into a hard block the moment anything else is
    // edited. The user has to state the action instead.
    expect(
      mapFor('update_rate_limit_rule', { zoneId: 'zone1', rulesetId: 'rs1', ruleId: 'r1' }).action
    ).toBeUndefined()

    expect(
      mapFor('update_rate_limit_rule', {
        zoneId: 'zone1',
        rulesetId: 'rs1',
        ruleId: 'r1',
        updateRateLimitAction: 'log',
      }).action
    ).toBe('log')
  })

  it('strips the aliased control ids so they never reach a tool as params', () => {
    const mapped = mapFor('create_dns_record', { zoneId: 'zone1' })

    for (const alias of [
      'recordType',
      'recordProxied',
      'certificateStatus',
      'appType',
      'updateAppType',
      'updatePolicyDecision',
      'rateLimitAction',
      'updateRateLimitAction',
      'rulesetName',
      'zoneNameFilter',
      'zoneType',
      'dnsTypeFilter',
      'dnsNameFilter',
      'dnsContentFilter',
      'dnsOrder',
      'dnsProxiedFilter',
      'purgeTags',
      'workerTagFilter',
      'accessAppTags',
      'listNameFilter',
      'accessAppDomainFilter',
      'tunnelStatus',
    ]) {
      expect(mapped[alias], `alias ${alias} reached the tool`).toBeUndefined()
    }
  })

  it('sends the ruleset name as the name param when creating a ruleset', () => {
    const mapped = mapFor('create_ruleset', {
      zoneId: 'zone1',
      phase: 'http_ratelimit',
      rulesetName: 'Zone rate limiting ruleset',
    })

    expect(mapped.name).toBe('Zone rate limiting ruleset')
    expect(mapped.rulesetName).toBeUndefined()
  })
})

/**
 * `shouldSerializeSubBlock` (serializer/index.ts) short-circuits on
 * `mode: 'advanced'` BEFORE evaluating `condition`, so an advanced control whose
 * stored value is non-empty is serialized even when the selected operation does
 * not render it. That is harmless while every operation that consumes the id
 * also exposes a control for it — the user can see and change the value — and it
 * is a silent cross-operation write when it does not.
 */
/**
 * Two mechanical guards on subBlock id reuse. Block state is keyed by subBlock
 * id, so controls sharing an id share one stored value — fine when they mean the
 * same thing, a silent cross-operation bug when they do not. These encode the
 * two shapes that divergence takes here.
 */
describe('a shared subBlock id means the same thing everywhere', () => {
  /**
   * Ids that legitimately span reads and writes because they address the
   * resource rather than carry payload: credentials, account/zone scope, the
   * R2 jurisdiction routing header, the ruleset phase, and resource ids.
   */
  const ADDRESSING_IDS = new Set([
    'apiKey',
    'operation',
    'accountId',
    'zoneId',
    'jurisdiction',
    'phase',
    'appId',
    'bucketName',
    'rulesetId',
  ])

  const WRITE_PREFIXES = ['create_', 'update_', 'delete_', 'purge_', 'revoke_']

  function operationsFor(subBlock: (typeof CloudflareBlock.subBlocks)[number]): string[] {
    const condition = subBlock.condition
    if (!condition || typeof condition !== 'object' || !('field' in condition)) return []
    if (condition.field !== 'operation') return []
    const value = condition.value
    return Array.isArray(value) ? value.map(String) : [String(value)]
  }

  it('never shares an id between a read filter and a written value', () => {
    const kindsById = new Map<string, Set<string>>()

    for (const subBlock of CloudflareBlock.subBlocks) {
      if (ADDRESSING_IDS.has(subBlock.id)) continue
      for (const operation of operationsFor(subBlock)) {
        const kind = WRITE_PREFIXES.some((prefix) => operation.startsWith(prefix))
          ? 'write'
          : 'read'
        const kinds = kindsById.get(subBlock.id) ?? new Set<string>()
        kinds.add(kind)
        kindsById.set(subBlock.id, kinds)
      }
    }

    const mixed = [...kindsById.entries()]
      .filter(([, kinds]) => kinds.size > 1)
      .map(([id]) => id)
      .sort()

    expect(mixed).toEqual([])
  })

  it('never gives one dropdown id two different option sets', () => {
    const optionsById = new Map<string, Set<string>>()

    for (const subBlock of CloudflareBlock.subBlocks) {
      if (subBlock.type !== 'dropdown' || !Array.isArray(subBlock.options)) continue
      const signature = JSON.stringify(
        subBlock.options.map((option) =>
          typeof option === 'string' ? option : ((option as { id?: string }).id ?? '')
        )
      )
      const signatures = optionsById.get(subBlock.id) ?? new Set<string>()
      signatures.add(signature)
      optionsById.set(subBlock.id, signatures)
    }

    const divergent = [...optionsById.entries()]
      .filter(([, signatures]) => signatures.size > 1)
      .map(([id, signatures]) => `${id}: ${[...signatures].join(' vs ')}`)

    expect(divergent).toEqual([])
  })
})

describe('no hidden advanced control feeds an operation that cannot show it', () => {
  const STALE = '__stale_value__'

  const toolsByOperation = new Map(
    Object.values(cloudflareTools).map((tool) => [tool.id.replace(/^cloudflare_/, ''), tool])
  )

  /** Operations a subBlock's `condition` makes it visible for. */
  function conditionOperations(subBlock: (typeof CloudflareBlock.subBlocks)[number]): string[] {
    const condition = subBlock.condition
    if (!condition || typeof condition !== 'object' || !('field' in condition)) return []
    if (condition.field !== 'operation') return []
    const value = condition.value
    return Array.isArray(value) ? value.map(String) : [String(value)]
  }

  it('every advanced id reaching a tool is either shown or remapped for that operation', () => {
    const operations = [...toolsByOperation.keys()]
    const visibleIdsByOperation = new Map<string, Set<string>>(
      operations.map((operation) => [operation, new Set<string>()])
    )
    for (const subBlock of CloudflareBlock.subBlocks) {
      for (const operation of conditionOperations(subBlock)) {
        visibleIdsByOperation.get(operation)?.add(subBlock.id)
      }
    }

    const leaks: string[] = []

    for (const subBlock of CloudflareBlock.subBlocks) {
      if (subBlock.mode !== 'advanced') continue
      const ownOperations = new Set(conditionOperations(subBlock))

      for (const operation of operations) {
        if (ownOperations.has(operation)) continue
        const tool = toolsByOperation.get(operation)
        if (!tool?.params || !(subBlock.id in tool.params)) continue
        if (visibleIdsByOperation.get(operation)?.has(subBlock.id)) continue

        // The mapper must overwrite or clear the stale value for this operation.
        const mapped = mapFor(operation, { [subBlock.id]: STALE })
        if (mapped[subBlock.id] === STALE) {
          leaks.push(
            `"${subBlock.id}" (advanced, shown for ${[...ownOperations].join('/') || 'nothing'}) reaches ${operation} as a param it never renders`
          )
        }
      }
    }

    expect(leaks).toEqual([])
  })
})
