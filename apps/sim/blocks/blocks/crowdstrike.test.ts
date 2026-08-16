/**
 * @vitest-environment node
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { RTR_READ_ONLY_BASE_COMMANDS } from '@/lib/api/contracts/tools/crowdstrike'
import { CrowdStrikeBlock } from '@/blocks/blocks/crowdstrike'

/**
 * `buildToolDescriptionMap` in `scripts/generate-docs.ts` searches only the 600
 * characters that follow a tool's `id:` for its `name:` and `description:`. A
 * description whose closing quote falls outside that window does not fail the
 * build — it silently publishes as an empty string in `integrations.json` and in
 * the generated MDX.
 */
const DOCS_GENERATOR_ID_WINDOW = 600

/** Leave headroom so a small wording edit cannot silently cross the window. */
const DESCRIPTION_SPAN_BUDGET = DOCS_GENERATOR_ID_WINDOW - 40

const mapParams = CrowdStrikeBlock.tools.config?.params
if (!mapParams) {
  throw new Error('CrowdStrike block must define tools.config.params')
}

const credentials = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  cloud: 'us-1',
}

/**
 * The executor merges the mapped params over the raw block inputs
 * (`{ ...inputs, ...transformedParams }`), so a key the mapper omits keeps its raw
 * subBlock value. Every assertion here runs against the merged result, because a
 * mapper-only assertion passes even when the raw value survives onto the wire.
 */
function merge(inputs: Record<string, unknown>) {
  return { ...inputs, ...mapParams(inputs) }
}

describe('CrowdStrike block params', () => {
  it('drops untouched optional subBlocks instead of forwarding their stored null', () => {
    const merged = merge({
      ...credentials,
      operation: 'crowdstrike_query_alerts',
      filter: null,
      q: null,
      limit: null,
      offset: null,
      sort: null,
      includeHidden: null,
    })

    expect(merged.filter).toBeUndefined()
    expect(merged.q).toBeUndefined()
    expect(merged.limit).toBeUndefined()
    expect(merged.offset).toBeUndefined()
    expect(merged.sort).toBeUndefined()
    expect(merged.includeHidden).toBeUndefined()
  })

  it('drops a blank alert update field rather than sending an empty action value', () => {
    const merged = merge({
      ...credentials,
      operation: 'crowdstrike_update_alerts',
      compositeIds: '["cid:aid:alert"]',
      updateStatus: 'closed',
      assignToUuid: null,
      appendComment: '',
      addTag: null,
    })

    expect(merged.updateStatus).toBe('closed')
    expect(merged.assignToUuid).toBeUndefined()
    expect(merged.appendComment).toBeUndefined()
    expect(merged.addTag).toBeUndefined()
  })

  it('clears an advanced value left over from another operation', () => {
    const merged = merge({
      ...credentials,
      operation: 'crowdstrike_init_rtr_session',
      deviceId: 'aid-1',
      includeHidden: 'true',
      q: 'stale free-text search',
      after: 'stale-cursor',
      updateStatus: 'closed',
    })

    expect(merged.deviceId).toBe('aid-1')
    expect(merged.includeHidden).toBeUndefined()
    expect(merged.q).toBeUndefined()
    expect(merged.after).toBeUndefined()
    expect(merged.updateStatus).toBeUndefined()
  })

  it('sends the free-text search only to the operations that accept it', () => {
    expect(
      merge({ ...credentials, operation: 'crowdstrike_query_alerts', q: 'ransomware' }).q
    ).toBe('ransomware')
    expect(
      merge({ ...credentials, operation: 'crowdstrike_query_host_groups', q: 'ransomware' }).q
    ).toBeUndefined()
  })

  it('sends the after cursor only to the cursor-paginated collections', () => {
    expect(
      merge({ ...credentials, operation: 'crowdstrike_query_indicators', after: 'cursor-1' }).after
    ).toBe('cursor-1')
    expect(
      merge({ ...credentials, operation: 'crowdstrike_query_alerts', after: 'cursor-1' }).after
    ).toBeUndefined()
  })

  it('never sends an offset to Spotlight, which paginates by cursor only', () => {
    const merged = merge({
      ...credentials,
      operation: 'crowdstrike_query_vulnerabilities',
      filter: "status:'open'",
      offset: '100',
    })

    expect(merged.filter).toBe("status:'open'")
    expect(merged.offset).toBeUndefined()
  })

  it('keeps the alert filter out of a destructive indicator delete', () => {
    const merged = merge({
      ...credentials,
      operation: 'crowdstrike_delete_indicators',
      indicatorIds: '["ioc-1"]',
      filter: "status:'new'",
      deleteFilter: null,
    })

    expect(merged.indicatorIds).toEqual(['ioc-1'])
    expect(merged.filter).toBeUndefined()
  })

  it('forwards the dedicated delete filter', () => {
    const merged = merge({
      ...credentials,
      operation: 'crowdstrike_delete_indicators',
      deleteFilter: "type:'sha256'",
    })

    expect(merged.filter).toBe("type:'sha256'")
  })

  it('rejects an IOC limit above the documented maximum of 500', () => {
    expect(() =>
      merge({ ...credentials, operation: 'crowdstrike_query_indicators', limit: '2000' })
    ).toThrow(/500/)
  })

  /**
   * Asserted against the contract constant rather than a second hand-maintained
   * literal: the route validates `base_command` with `RTR_READ_ONLY_BASE_COMMANDS`,
   * so a dropdown that drifts from it either hides a command the API accepts or
   * offers one the API rejects. Duplicating the list here would just move the
   * drift into the test.
   */
  it('offers exactly the read-tier RTR base command families the contract accepts', () => {
    const baseCommand = CrowdStrikeBlock.subBlocks.find((subBlock) => subBlock.id === 'baseCommand')
    const ids = (baseCommand?.options as { id: string }[] | undefined)?.map((option) => option.id)

    expect(ids).toEqual([...RTR_READ_ONLY_BASE_COMMANDS])
  })

  it('offers no write-tier RTR base command under the read-scoped tool', () => {
    const baseCommand = CrowdStrikeBlock.subBlocks.find((subBlock) => subBlock.id === 'baseCommand')
    const ids = (baseCommand?.options as { id: string }[] | undefined)?.map((option) => option.id)

    for (const writeTier of ['eventlog backup', 'eventlog export', 'put', 'get', 'runscript']) {
      expect(ids).not.toContain(writeTier)
    }
  })

  it('exposes every CrowdStrike commercial and GovCloud region', () => {
    const cloud = CrowdStrikeBlock.subBlocks.find((subBlock) => subBlock.id === 'cloud')
    const ids = (cloud?.options as { id: string }[] | undefined)?.map((option) => option.id)

    expect(ids).toEqual(['us-1', 'us-2', 'us-3', 'eu-1', 'us-gov-1', 'us-gov-2'])
  })

  it('does not preselect the network-isolating host action', () => {
    const hostAction = CrowdStrikeBlock.subBlocks.find(
      (subBlock) => subBlock.id === 'hostActionName'
    )
    const ids = (hostAction?.options as { id: string }[] | undefined)?.map((option) => option.id)

    expect(hostAction?.value).toBeUndefined()
    expect(ids).toContain('detection_suppress')
    expect(ids).toContain('detection_unsuppress')
  })

  /**
   * CrowdStrike declares `include_hidden` with `"default": true` on every alert
   * endpoint this switch feeds, so omitting the parameter still returns hidden
   * alerts. A switch that renders off while the wire behaves as on tells the
   * analyst the opposite of what Falcon does.
   */
  it('seeds the hidden-alert switch on, matching the CrowdStrike default', () => {
    const includeHidden = CrowdStrikeBlock.subBlocks.find(
      (subBlock) => subBlock.id === 'includeHidden'
    )

    expect(includeHidden?.value?.({})).toBe('true')
  })

  it.each([
    ['crowdstrike_query_alerts', {}],
    ['crowdstrike_get_alert_details', { compositeIds: '["cid:aid:alert"]' }],
    ['crowdstrike_update_alerts', { compositeIds: '["cid:aid:alert"]', updateStatus: 'closed' }],
  ])('sends the seeded hidden-alert switch as an explicit true for %s', (operation, extra) => {
    const includeHidden = CrowdStrikeBlock.subBlocks.find(
      (subBlock) => subBlock.id === 'includeHidden'
    )

    const merged = merge({
      ...credentials,
      ...extra,
      operation,
      includeHidden: includeHidden?.value?.({}),
    })

    expect(merged.includeHidden).toBe(true)
  })

  it('still sends false when the analyst turns the hidden-alert switch off', () => {
    const merged = merge({
      ...credentials,
      operation: 'crowdstrike_query_alerts',
      includeHidden: false,
    })

    expect(merged.includeHidden).toBe(false)
  })

  it('keeps every tool description inside the docs generator id-search window', () => {
    const toolsDir = path.join(__dirname, '../../tools/crowdstrike')
    const offenders: string[] = []

    for (const file of fs.readdirSync(toolsDir)) {
      if (file === 'index.ts' || file === 'types.ts') continue
      const source = fs.readFileSync(path.join(toolsDir, file), 'utf-8')
      const idIndex = source.search(/\bid\s*:\s*'crowdstrike_/)
      const descriptionEnd = source.indexOf("',", source.indexOf('description:'))
      if (idIndex < 0 || descriptionEnd < 0) continue
      const span = descriptionEnd + 2 - idIndex
      if (span > DESCRIPTION_SPAN_BUDGET) {
        offenders.push(`${file} (${span} chars)`)
      }
    }

    expect(offenders).toEqual([])
  })
})
