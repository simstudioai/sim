/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { CrowdStrikeBlock } from '@/blocks/blocks/crowdstrike'

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

  it('offers every documented read-tier RTR base command', () => {
    const baseCommand = CrowdStrikeBlock.subBlocks.find((subBlock) => subBlock.id === 'baseCommand')
    const ids = (baseCommand?.options as { id: string }[] | undefined)?.map((option) => option.id)

    expect(ids).toEqual([
      'cat',
      'cd',
      'clear',
      'csrutil',
      'env',
      'eventlog backup',
      'eventlog export',
      'eventlog list',
      'eventlog view',
      'filehash',
      'getsid',
      'help',
      'history',
      'ifconfig',
      'ipconfig',
      'ls',
      'mount',
      'netstat',
      'ps',
      'reg query',
      'users',
    ])
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
})
