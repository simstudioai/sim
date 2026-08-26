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
import { afterEach, describe, expect, it, vi } from 'vitest'
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
      'zoneType',
      'recordType',
      'recordProxied',
      'recordTags',
      'updateRecordType',
      'updateRecordName',
      'updateRecordContent',
      'updateRecordProxied',
      'updateRecordTags',
      'dnsOrder',
      'certificateStatus',
      'rulesetName',
      'updateRuleEnabled',
      'rateLimitAction',
      'updateRateLimitAction',
      'appType',
      'updateAppType',
      'accessAppTags',
      'updatePolicyDecision',
      'listNameFilter',
      'accessAppDomainFilter',
      'workerTagFilter',
      'tunnelStatus',
      'r2Cursor',
      'rulesetCursor',
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

  /**
   * Ids a read filter and a written value share on purpose. Both sides render a
   * control the user can see and edit for their own operation, so a carried-over
   * value is visible rather than hidden — and these are the ids shipped
   * workflows already store, which a rename would strand (see
   * `the ids shipped workflows already store are still live`).
   */
  const SHARED_VISIBLE_IDS = new Set(['name', 'content'])

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
      if (ADDRESSING_IDS.has(subBlock.id) || SHARED_VISIBLE_IDS.has(subBlock.id)) continue
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

  /**
   * A subBlock can also be hidden by a guard on a field other than `operation`
   * (purge_cache's targets are hidden once `purge_everything` is yes). An
   * advanced control serializes on stored value alone, so the serializer never
   * reaches that guard either — the mapper has to clear it.
   */
  it('clears every advanced control whose own guard field hides it', () => {
    const leaks: string[] = []

    for (const subBlock of CloudflareBlock.subBlocks) {
      if (subBlock.mode !== 'advanced') continue
      const guard = (
        subBlock.condition as { and?: { field: string; value: unknown; not?: boolean } } | undefined
      )?.and
      if (!guard || guard.field === 'operation') continue

      const hidingValue = guard.not === true ? String(guard.value) : '__guard_off__'

      for (const operation of conditionOperations(subBlock)) {
        const tool = toolsByOperation.get(operation)
        if (!tool?.params || !(subBlock.id in tool.params)) continue

        const mapped = mapFor(operation, {
          [guard.field]: hidingValue,
          [subBlock.id]: STALE,
        })
        if (mapped[subBlock.id] === STALE) {
          leaks.push(
            `"${subBlock.id}" reaches ${operation} when ${guard.field}=${hidingValue} hides it`
          )
        }
      }
    }

    expect(leaks).toEqual([])
  })
})

/**
 * Block state is never migrated, and `extractBlockParams` (`serializer/index.ts`)
 * drops a stored value whose id matches no subBlock config — for a non-custom
 * block that is a deleted input. So renaming a control strands whatever shipped
 * workflows stored under the old id, and no mapper-level fallback can recover
 * it: the value is gone before `tools.config.params` runs.
 *
 * That decides which side of an id collision may be renamed. A read filter that
 * loses its value returns the whole zone with `success: true` — which a
 * downstream `delete_dns_record` then fans out over — so filters keep the ids
 * shipped workflows already hold. A write control that loses its value just
 * omits the field from a PATCH, so the new id goes there.
 */
describe('the ids shipped workflows already store are still live', () => {
  function operationsFor(id: string): string[] {
    return CloudflareBlock.subBlocks.flatMap((subBlock) => {
      if (subBlock.id !== id) return []
      const condition = subBlock.condition
      if (!condition || typeof condition !== 'object' || !('field' in condition)) return []
      if (condition.field !== 'operation') return []
      const value = condition.value
      return Array.isArray(value) ? value.map(String) : [String(value)]
    })
  }

  it.each([
    ['list_dns_records', 'type'],
    ['list_dns_records', 'name'],
    ['list_dns_records', 'content'],
    ['list_dns_records', 'proxied'],
    ['list_dns_records', 'search'],
    ['list_zones', 'name'],
    ['list_zones', 'status'],
    ['purge_cache', 'tags'],
  ])('%s still reads its %s filter from the id it shipped with', (operation, id) => {
    expect(operationsFor(id)).toContain(operation)
  })

  it('still passes each of those filters through to the tool', () => {
    const records = mapFor('list_dns_records', {
      zoneId: 'zone1',
      type: 'A',
      name: 'www.example.com',
      content: '203.0.113.10',
      proxied: 'true',
      search: 'legacy',
    })
    expect(records.type).toBe('A')
    expect(records.name).toBe('www.example.com')
    expect(records.content).toBe('203.0.113.10')
    expect(records.proxied).toBe(true)
    expect(records.search).toBe('legacy')

    expect(mapFor('list_zones', { name: 'example.com', status: 'active' })).toMatchObject({
      name: 'example.com',
      status: 'active',
    })
    expect(mapFor('purge_cache', { zoneId: 'z1', tags: 'a,b' }).tags).toBe('a,b')
  })
})

describe('the rule enable switch is split between creating and updating', () => {
  it('never carries a create-time enabled onto a rule update', () => {
    // `enabled` is advanced, so it serializes on stored value alone, before its
    // condition runs. Shared, a `false` chosen while drafting a new rule would
    // disable a live WAF or rate limiting rule on a later update.
    for (const operation of ['update_ruleset_rule', 'update_rate_limit_rule']) {
      const mapped = mapFor(operation, {
        zoneId: 'z1',
        rulesetId: 'rs1',
        ruleId: 'r1',
        enabled: 'false',
      })
      expect(mapped.enabled, `${operation} took a create-time enabled`).toBeUndefined()
    }
  })

  it('sends the update control when the caller sets it', () => {
    expect(
      mapFor('update_ruleset_rule', {
        zoneId: 'z1',
        rulesetId: 'rs1',
        ruleId: 'r1',
        updateRuleEnabled: 'false',
      }).enabled
    ).toBe(false)
  })

  it('still sends the create control on the create operations', () => {
    expect(
      mapFor('create_ruleset_rule', { zoneId: 'z1', rulesetId: 'rs1', enabled: 'false' }).enabled
    ).toBe(false)
  })
})

describe('a DNS record rename cannot be inherited from another operation', () => {
  it('ignores a name typed under any other operation', () => {
    // `name` is shared by zone, Access application, policy, and service token
    // creation. The update control is advanced, so a shared id let any of those
    // reach the PATCH and rename the live record.
    expect(
      mapFor('update_dns_record', { zoneId: 'z1', recordId: 'rec1', name: 'ci-pipeline' }).name
    ).toBeUndefined()
  })

  it('renames only when the record-name control is set', () => {
    expect(
      mapFor('update_dns_record', {
        zoneId: 'z1',
        recordId: 'rec1',
        updateRecordName: 'www.example.com',
      }).name
    ).toBe('www.example.com')
  })
})

describe('Access application types the API can actually build', () => {
  const appTypeOptions = (id: string) => {
    const subBlock = CloudflareBlock.subBlocks.find((sub) => sub.id === id)
    const options = subBlock?.options
    return (Array.isArray(options) ? options : []).map((option) =>
      typeof option === 'string' ? option : ((option as { id?: string }).id ?? '')
    )
  }

  it('drops dash_sso, which has no request variant at all', () => {
    expect(appTypeOptions('appType')).not.toContain('dash_sso')
    expect(appTypeOptions('updateAppType')).not.toContain('dash_sso')
  })

  it('requires a domain exactly for the types whose request schema demands one', () => {
    const domain = CloudflareBlock.subBlocks.find((sub) => sub.id === 'domain')
    const required = domain?.required
    expect(typeof required).toBe('function')
    const resolve = required as (values?: Record<string, unknown>) => {
      field: string
      value: string | number | boolean | Array<string | number | boolean>
    }

    const onCreate = resolve({ operation: 'create_access_application' })
    expect(onCreate.field).toBe('appType')
    expect(onCreate.value).toEqual(['self_hosted', 'ssh', 'vnc', 'rdp'])

    const onUpdate = resolve({ operation: 'update_access_application' })
    expect(onUpdate.field).toBe('updateAppType')
    expect(onUpdate.value).toEqual(['self_hosted', 'ssh', 'vnc', 'rdp'])
  })

  it('carries the fields saas, infrastructure, and rdp applications cannot be created without', () => {
    for (const tool of [
      cloudflareTools.cloudflareCreateAccessApplicationTool,
      cloudflareTools.cloudflareUpdateAccessApplicationTool,
    ]) {
      const body = tool.request.body?.({
        accountId: 'acct1',
        appId: 'app1',
        apiKey,
        type: 'saas',
        saasApp: '{"auth_type":"saml"}',
        targetCriteria: '[{"port":22,"protocol":"SSH"}]',
      } as never) as Record<string, unknown>

      expect(body.saas_app).toEqual({ auth_type: 'saml' })
      expect(body.target_criteria).toEqual([{ port: 22, protocol: 'SSH' }])
    }
  })
})

describe('the ruleset kind offered matches the endpoint', () => {
  it('does not offer root, which only exists at the account level', () => {
    const kind = CloudflareBlock.subBlocks.find((sub) => sub.id === 'kind')
    const options = (Array.isArray(kind?.options) ? kind.options : []).map(
      (option) => (option as { id?: string }).id ?? ''
    )

    expect(options).not.toContain('root')
    expect(options).toContain('zone')
  })
})

describe('an update that would tear down the rule it edits is refused', () => {
  const updateRule = cloudflareTools.cloudflareUpdateRulesetRuleTool

  it('refuses an execute rule with no action parameters', () => {
    // PATCH replaces the rule, so omitting action_parameters resets it to {} and
    // unbinds the managed ruleset the rule deploys, plus every override under it.
    expect(() =>
      updateRule.request.body?.({
        zoneId: 'z1',
        rulesetId: 'rs1',
        ruleId: 'r1',
        apiKey,
        action: 'execute',
        expression: 'true',
      } as never)
    ).toThrow(/Action Parameters is required/)
  })

  /**
   * An explicit `{}` is the same payload Cloudflare's schema default produces, so
   * it does the same damage as omitting the field. Checking presence rather than
   * emptiness let it through the guard.
   */
  it('refuses an execute rule whose action parameters are an empty object', () => {
    expect(() =>
      updateRule.request.body?.({
        zoneId: 'z1',
        rulesetId: 'rs1',
        ruleId: 'r1',
        apiKey,
        action: 'execute',
        expression: 'true',
        actionParameters: '{}',
      } as never)
    ).toThrow(/Action Parameters is required/)
  })

  it('leaves an empty action parameters object alone on a non-execute action', () => {
    const body = updateRule.request.body?.({
      zoneId: 'z1',
      rulesetId: 'rs1',
      ruleId: 'r1',
      apiKey,
      action: 'block',
      expression: 'true',
      actionParameters: '{}',
    } as never) as Record<string, unknown>

    expect(body.action_parameters).toEqual({})
  })

  it('accepts an execute rule that resends its action parameters', () => {
    const body = updateRule.request.body?.({
      zoneId: 'z1',
      rulesetId: 'rs1',
      ruleId: 'r1',
      apiKey,
      action: 'execute',
      expression: 'true',
      actionParameters: '{"id":"managed-1"}',
    } as never) as Record<string, unknown>

    expect(body.action_parameters).toEqual({ id: 'managed-1' })
  })

  it('leaves non-execute actions alone', () => {
    expect(() =>
      updateRule.request.body?.({
        zoneId: 'z1',
        rulesetId: 'rs1',
        ruleId: 'r1',
        apiKey,
        action: 'block',
        expression: 'true',
      } as never)
    ).not.toThrow()
  })

  it('warns in both descriptions that omission resets the field', () => {
    expect(updateRule.params.actionParameters.description).toMatch(/resets action_parameters/)
    expect(updateRule.params.ref.description).toMatch(/omitting it resets/)
  })

  it('requires action parameters in the block whenever the action is execute', () => {
    const actionParameters = CloudflareBlock.subBlocks.find((sub) => sub.id === 'actionParameters')
    expect(actionParameters?.required).toEqual({ field: 'action', value: 'execute' })
  })
})

describe('optional and per-API pagination params', () => {
  it('does not force a metrics list the DNS analytics API treats as optional', () => {
    expect(cloudflareTools.cloudflareDnsAnalyticsTool.params.metrics.required).toBe(false)
  })

  it('keeps the R2 and ruleset cursors apart', () => {
    // R2 answers with result_info.cursor and the Rulesets API with
    // result_info.cursors.after, so a cursor carried across the two 400s.
    expect(
      mapFor('list_r2_buckets', { accountId: 'a1', rulesetCursor: 'ruleset-1' }).cursor
    ).toBeUndefined()
    expect(mapFor('list_rulesets', { zoneId: 'z1', r2Cursor: 'r2-1' }).cursor).toBeUndefined()
    expect(mapFor('list_r2_buckets', { accountId: 'a1', r2Cursor: 'r2-1' }).cursor).toBe('r2-1')
    expect(mapFor('list_rulesets', { zoneId: 'z1', rulesetCursor: 'ruleset-1' }).cursor).toBe(
      'ruleset-1'
    )
  })
})

/** Builds the Cloudflare v4 envelope every tool's transformResponse reads. */
function envelope(result: unknown, success = true): Response {
  return new Response(JSON.stringify({ success, errors: [], messages: [], result }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('DNS analytics does not fabricate metrics Cloudflare did not return', () => {
  const tool = cloudflareTools.cloudflareDnsAnalyticsTool

  it('passes min and max through instead of filling seven zeroes', async () => {
    // Cloudflare documents both as "currently always an empty object", so a
    // seven-field numeric block is fabricated telemetry.
    const out = (await tool.transformResponse!(
      envelope({ totals: { queryCount: 12 }, min: {}, max: {}, data: [], rows: 0 }),
      {} as never
    )) as { output: { min: unknown; max: unknown } }

    expect(out.output.min).toEqual({})
    expect(out.output.max).toEqual({})
  })

  it('reports an absent min or max as null rather than zeroes', async () => {
    const out = (await tool.transformResponse!(envelope({ totals: {} }), {} as never)) as {
      output: { min: unknown; max: unknown }
    }

    expect(out.output.min).toBeNull()
    expect(out.output.max).toBeNull()
  })

  it('leaves an unrequested total absent instead of reading it as zero', async () => {
    const out = (await tool.transformResponse!(
      envelope({ totals: { queryCount: 12 } }),
      {} as never
    )) as { output: { totals: Record<string, unknown> } }

    expect(out.output.totals.queryCount).toBe(12)
    expect(out.output.totals.responseTimeAvg).toBeUndefined()
    expect(out.output.totals.uncachedCount).toBeUndefined()
  })

  it('declares min and max as opaque JSON, not a numeric object', () => {
    expect(tool.outputs?.min).toMatchObject({ type: 'json' })
    expect(tool.outputs?.max).toMatchObject({ type: 'json' })
    expect((tool.outputs?.min as { description: string }).description).toMatch(/empty object/i)
  })

  it('keeps metrics optional in the block, matching the tool and the API', () => {
    const metrics = CloudflareBlock.subBlocks.find((sub) => sub.id === 'metrics')
    expect(metrics?.required).toBeUndefined()
    expect(tool.params.metrics.required).toBe(false)
    expect(tool.params.metrics.description).not.toMatch(/default metric set/i)
  })
})

describe('purge cache refuses an ambiguous whole-zone purge', () => {
  const buildBody = cloudflareTools.cloudflarePurgeCacheTool.request.body!

  it('throws when purge_everything is combined with a target list', () => {
    expect(() =>
      buildBody({
        zoneId: 'z1',
        apiKey,
        purge_everything: true,
        files: 'https://example.com/a.css',
      } as never)
    ).toThrow(/cannot be combined with specific targets/)
  })

  it('still purges everything when no targets were given', () => {
    expect(buildBody({ zoneId: 'z1', apiKey, purge_everything: true } as never)).toEqual({
      purge_everything: true,
    })
  })

  it('defaults the block dropdown to purging specific targets', () => {
    const purgeEverything = CloudflareBlock.subBlocks.find((sub) => sub.id === 'purge_everything')
    expect((purgeEverything?.value as () => string)()).toBe('false')
  })

  /**
   * `tags`, `hosts`, and `prefixes` are advanced, so the serializer emits their
   * stored value before evaluating the `purge_everything` guard that hides them.
   * A target typed before switching to a whole-zone purge therefore survived and
   * made the tool refuse the purge over a field the editor no longer renders.
   */
  it('drops targets typed before the switch to a whole-zone purge', () => {
    const mapped = mapFor('purge_cache', {
      zoneId: 'z1',
      purge_everything: 'true',
      files: 'https://example.com/a.css',
      tags: 'homepage',
      hosts: 'example.com',
      prefixes: 'https://example.com/assets/',
    })

    expect(mapped.files).toBeUndefined()
    expect(mapped.tags).toBeUndefined()
    expect(mapped.hosts).toBeUndefined()
    expect(mapped.prefixes).toBeUndefined()
    expect(buildBody(mapped as never)).toEqual({ purge_everything: true })
  })

  it('still purges the named targets when purge everything is no', () => {
    const mapped = mapFor('purge_cache', {
      zoneId: 'z1',
      purge_everything: 'false',
      tags: 'homepage',
    })

    expect(mapped.tags).toBe('homepage')
    expect(buildBody(mapped as never)).toEqual({ tags: ['homepage'] })
  })
})

describe('a rate limiting rule update keeps the fields the endpoint would reset', () => {
  const updateRule = cloudflareTools.cloudflareUpdateRateLimitRuleTool

  const base = {
    zoneId: 'z1',
    rulesetId: 'rs1',
    ruleId: 'r1',
    apiKey,
    action: 'block',
    expression: 'true',
    characteristics: 'cf.colo.id,ip.src',
    period: 60,
    requestsPerPeriod: 100,
  }

  /**
   * The rulesets update-rule endpoint replaces the whole rule definition, so a
   * custom block response and the reference tag have to be resent or Cloudflare
   * resets them — the block page comes back and the ref regenerates.
   */
  it('forwards the custom mitigation response, reference tag, and logging', () => {
    const body = updateRule.request.body?.({
      ...base,
      ref: 'api-throttle',
      actionParameters:
        '{"response":{"status_code":429,"content":"{\\"error\\":\\"rate limited\\"}","content_type":"application/json"}}',
      logging: '{"enabled":true}',
    } as never) as Record<string, unknown>

    expect(body.ref).toBe('api-throttle')
    expect(body.action_parameters).toEqual({
      response: {
        status_code: 429,
        content: '{"error":"rate limited"}',
        content_type: 'application/json',
      },
    })
    expect(body.logging).toEqual({ enabled: true })
  })

  it('declares the three fields as tool params so a caller can resend them', () => {
    expect(updateRule.params.ref).toBeDefined()
    expect(updateRule.params.actionParameters).toBeDefined()
    expect(updateRule.params.logging).toBeDefined()
    expect(updateRule.params.actionParameters.description).toMatch(/resets action_parameters/)
    expect(updateRule.params.ref.description).toMatch(/omitting it resets/)
  })

  it('omits them entirely when the caller sends nothing', () => {
    const body = updateRule.request.body?.(base as never) as Record<string, unknown>

    expect(body).not.toHaveProperty('ref')
    expect(body).not.toHaveProperty('action_parameters')
    expect(body).not.toHaveProperty('logging')
  })

  it('offers all three in the block for the rate limiting update', () => {
    const shownFor = (id: string) =>
      CloudflareBlock.subBlocks.flatMap((subBlock) => {
        if (subBlock.id !== id) return []
        const condition = subBlock.condition
        if (!condition || typeof condition !== 'object' || !('field' in condition)) return []
        if (condition.field !== 'operation') return []
        const value = condition.value
        return Array.isArray(value) ? value.map(String) : [String(value)]
      })

    expect(shownFor('ref')).toContain('update_rate_limit_rule')
    expect(shownFor('logging')).toContain('update_rate_limit_rule')
    expect(shownFor('rateLimitActionParameters')).toEqual(['update_rate_limit_rule'])
  })

  /**
   * The WAF control named "Action Parameters" holds a managed-ruleset payload,
   * which is not what a rate limiting rule takes, so the two must stay separate
   * controls that map onto the same tool param.
   */
  it('routes the rate limiting control onto the tool param without sharing the WAF one', () => {
    expect(
      mapFor('update_rate_limit_rule', {
        zoneId: 'z1',
        rulesetId: 'rs1',
        ruleId: 'r1',
        actionParameters: '{"id":"managed-1"}',
        rateLimitActionParameters: '{"response":{"status_code":429}}',
      }).actionParameters
    ).toBe('{"response":{"status_code":429}}')

    expect(
      mapFor('update_ruleset_rule', {
        zoneId: 'z1',
        rulesetId: 'rs1',
        ruleId: 'r1',
        actionParameters: '{"id":"managed-1"}',
      }).actionParameters
    ).toBe('{"id":"managed-1"}')
  })
})

describe('zone settings are read through the endpoints Cloudflare still supports', () => {
  const tool = cloudflareTools.cloudflareGetZoneSettingsTool

  function settingEnvelope(id: string, value: unknown) {
    return new Response(
      JSON.stringify({
        success: true,
        errors: [],
        messages: [],
        result: { id, value, editable: true, modified_on: '2026-01-01T00:00:00Z' },
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * Cloudflare deprecated the batch `GET /zones/{zone_id}/settings` endpoint,
   * with end of life on 2027-03-31, and directs integrations at the per-setting
   * endpoint instead.
   */
  it('does not declare the deprecated batch settings endpoint', () => {
    const declaredUrl = tool.request.url({ zoneId: 'z1', apiKey } as never)
    expect(declaredUrl).not.toMatch(/\/zones\/z1\/settings$/)
    expect(declaredUrl).toMatch(/\/zones\/z1\/settings\/[a-z0-9_]+$/)
  })

  it('issues one request per setting against the per-setting endpoint', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => settingEnvelope(String(input).split('/').pop()!, 'on'))

    await tool.directExecution!({ zoneId: 'z1', apiKey, settingIds: 'ssl,http3' } as never)

    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      'https://api.cloudflare.com/client/v4/zones/z1/settings/ssl',
      'https://api.cloudflare.com/client/v4/zones/z1/settings/http3',
    ])
  })

  it('returns each setting under the list shape the block already reads', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      settingEnvelope(String(input).split('/').pop()!, 'full')
    )

    const out = (await tool.directExecution!({
      zoneId: 'z1',
      apiKey,
      settingIds: 'ssl',
    } as never)) as {
      success: boolean
      output: { settings: Array<Record<string, unknown>>; unreadable: unknown[] }
    }

    expect(out.success).toBe(true)
    expect(out.output.settings).toEqual([
      { id: 'ssl', value: 'full', editable: true, modified_on: '2026-01-01T00:00:00Z' },
    ])
    expect(out.output.unreadable).toEqual([])
  })

  /**
   * A plan-gated setting answers with an error rather than a value, and one
   * refusal must not lose the settings that did come back.
   */
  it('reports a refused setting without dropping the readable ones', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const settingId = String(input).split('/').pop()!
      if (settingId === 'http3') {
        return new Response(
          JSON.stringify({
            success: false,
            errors: [{ code: 1006, message: 'Not available for this plan' }],
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      }
      return settingEnvelope(settingId, 'full')
    })

    const out = (await tool.directExecution!({
      zoneId: 'z1',
      apiKey,
      settingIds: 'ssl,http3',
    } as never)) as {
      success: boolean
      output: { settings: Array<{ id: string }>; unreadable: Array<{ id: string; error: string }> }
    }

    expect(out.success).toBe(true)
    expect(out.output.settings.map((setting) => setting.id)).toEqual(['ssl'])
    expect(out.output.unreadable).toEqual([{ id: 'http3', error: 'Not available for this plan' }])
  })

  it('fails only when nothing at all could be read', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ success: false, errors: [{ message: 'Invalid zone identifier' }] }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    )

    const out = (await tool.directExecution!({
      zoneId: 'z1',
      apiKey,
      settingIds: 'ssl',
    } as never)) as { success: boolean; error?: string }

    expect(out.success).toBe(false)
    expect(out.error).toBe('Invalid zone identifier')
  })

  /**
   * The zone id is guarded ONCE above the fan-out. Re-guarding it per setting
   * raised the same error up to 40 times and filled `unreadable` with 40
   * identical rows before the call failed.
   */
  it('reports a bad zone id once, with no requests and no unreadable rows', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    const out = (await tool.directExecution!({
      zoneId: '..',
      apiKey,
      settingIds: Array.from({ length: 40 }, (_, index) => `setting_${index}`).join(','),
    } as never)) as {
      success: boolean
      error?: string
      output: { settings: unknown[]; unreadable: unknown[] }
    }

    expect(out.success).toBe(false)
    expect(out.error).toMatch(/zoneId/)
    expect(out.output.unreadable).toEqual([])
    expect(out.output.settings).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses an unbounded fan-out instead of issuing the requests', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    const out = (await tool.directExecution!({
      zoneId: 'z1',
      apiKey,
      settingIds: Array.from({ length: 41 }, (_, index) => `setting_${index}`).join(','),
    } as never)) as { success: boolean; error?: string }

    expect(out.success).toBe(false)
    expect(out.error).toMatch(/at most 40/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('the top-level priority field is described the way Cloudflare defines it', () => {
  /**
   * Cloudflare accepts the top-level `priority` for MX and URI records and
   * ignores it for every other type, SRV included — an SRV record carries its
   * priority inside the record content. Saying "MX and SRV" invites a model to
   * send a value Cloudflare drops while returning 200.
   */
  it.each([
    ['update_dns_record param', cloudflareTools.cloudflareUpdateDnsRecordTool.params.priority],
    [
      'update_dns_record output',
      cloudflareTools.cloudflareUpdateDnsRecordTool.outputs!.priority as { description: string },
    ],
    [
      'list_dns_records output',
      (
        cloudflareTools.cloudflareListDnsRecordsTool.outputs!.records as never as {
          items: { properties: Record<string, { description: string }> }
        }
      ).items.properties.priority,
    ],
  ])('%s does not claim SRV uses the top-level priority', (_name, described) => {
    expect(described.description).not.toMatch(/MX and SRV|MX\/SRV/)
    expect(described.description).toMatch(/URI/)
  })

  it('keeps the block placeholder and input description off SRV too', () => {
    for (const subBlock of CloudflareBlock.subBlocks) {
      if (subBlock.id !== 'priority') continue
      expect(subBlock.placeholder).not.toMatch(/MX and SRV|MX\/SRV/)
    }
    expect(CloudflareBlock.inputs.priority.description).not.toMatch(/MX and SRV|MX\/SRV/)
    expect(CloudflareBlock.inputs.priority.description).toMatch(/URI/)
  })
})

describe('a blank optional number never reaches a tool as zero', () => {
  /**
   * `Number('')` is `0`, and the DNS tools forward `priority`/`ttl` on presence
   * rather than truthiness — so a truthiness guard turned a blank advanced field
   * into a TTL of 0 (out of Cloudflare's 30-86400 range) and a priority of 0.
   */
  it.each([
    ['create_dns_record', 'ttl'],
    ['create_dns_record', 'priority'],
    ['list_zones', 'page'],
    ['list_zones', 'per_page'],
    ['dns_analytics', 'limit'],
  ])('%s leaves a blank %s undefined rather than 0', (operation, field) => {
    for (const blank of ['', null]) {
      const mapped = mapFor(operation, { zoneId: 'z1', accountId: 'a1', [field]: blank })
      expect(mapped[field], `${operation}.${field} from ${JSON.stringify(blank)}`).toBeUndefined()
      expect(mapped[field]).not.toBe(0)
    }
  })

  /**
   * The mapper handing on `''` is what produces the `0`: the DNS tools forward
   * on `!== undefined`, and `Number('')` is `0`. This walks that last step so
   * the assertion is about the request Cloudflare actually receives.
   */
  it.each([
    ['create_dns_record', cloudflareTools.cloudflareCreateDnsRecordTool],
    ['update_dns_record', cloudflareTools.cloudflareUpdateDnsRecordTool],
  ])('%s sends no ttl or priority at all when both are blank', (operation, tool) => {
    const mapped = mapFor(operation, {
      zoneId: 'z1',
      recordId: 'rec1',
      name: 'mail.example.com',
      content: 'mx.example.com',
      recordType: 'MX',
      updateRecordType: 'MX',
      ttl: '',
      priority: '',
    })

    const body = tool.request.body?.(mapped as never) as Record<string, unknown>
    expect(body).not.toHaveProperty('ttl')
    expect(body).not.toHaveProperty('priority')
    expect(body.ttl).not.toBe(0)
    expect(body.priority).not.toBe(0)
  })

  it('still coerces a supplied value to a number', () => {
    expect(mapFor('create_dns_record', { zoneId: 'z1', ttl: '3600' }).ttl).toBe(3600)
    expect(mapFor('create_dns_record', { zoneId: 'z1', priority: '10' }).priority).toBe(10)
    expect(mapFor('list_zones', { page: '2', per_page: '50' })).toMatchObject({
      page: 2,
      per_page: 50,
    })
  })
})

describe('list transforms survive a non-array result', () => {
  it.each([
    ['list_zones', cloudflareTools.cloudflareListZonesTool, 'zones'],
    ['list_dns_records', cloudflareTools.cloudflareListDnsRecordsTool, 'records'],
    ['list_certificates', cloudflareTools.cloudflareListCertificatesTool, 'certificates'],
  ])('%s returns an empty list rather than throwing', async (_name, tool, key) => {
    // A success:true body whose result is an object (or null) must not throw a
    // raw TypeError out of transformResponse.
    const out = (await tool.transformResponse!(envelope({ unexpected: true }), {} as never)) as {
      output: Record<string, unknown>
    }
    expect(out.output[key]).toEqual([])
  })
})
