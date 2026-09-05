/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { listCandidatesSchema } from '@/lib/internal/oracle-fusion-recruiting/schema'
import { OracleFusionRecruitingBlock } from '@/blocks/blocks/oracle_fusion_recruiting'
import * as recruitingTools from '@/tools/oracle_fusion_recruiting'

const tools = Object.values(recruitingTools)

describe('Recruiting block and tools', () => {
  it('exposes exactly the agreed 28 operations and maps each to its tool', () => {
    expect(tools).toHaveLength(28)
    const options = OracleFusionRecruitingBlock.subBlocks.find(
      (field) => field.id === 'operation'
    )?.options
    if (!Array.isArray(options)) throw new Error('Expected operation choices')
    const ids = tools.map((tool) => tool.id).sort()
    const mapped = options.map(({ id }) =>
      OracleFusionRecruitingBlock.tools.config.tool({ operation: id })
    )
    expect(mapped.sort()).toEqual(ids)
    expect([...OracleFusionRecruitingBlock.tools.access].sort()).toEqual(ids)
  })

  it.each(tools)('$id uses the saved credential and one in-process boundary', (tool) => {
    expect(tool.oauth).toMatchObject({
      provider: 'oracle_fusion_recruiting',
      credentialKind: 'service-account',
      authoritativeParams: ['instanceUrl'],
    })
    expect(tool.operation).toBeDefined()
    expect(tool.request).toBeUndefined()
    expect(tool.params).toMatchObject({
      accessToken: { visibility: 'hidden' },
      instanceUrl: { visibility: 'hidden' },
      oauthCredential: { required: true, visibility: 'user-only' },
    })
  })

  it('does not coerce unresolved references during tool selection', () => {
    const params = { operation: 'get_offer', offerId: '<previous.output.offerId>' }
    expect(OracleFusionRecruitingBlock.tools.config.tool(params)).toBe(
      'oracle_fusion_recruiting_get_offer'
    )
    expect(params.offerId).toBe('<previous.output.offerId>')
  })

  it('keeps canonical picker and manual IDs distinct from their input keys', () => {
    const fields = OracleFusionRecruitingBlock.subBlocks
    for (const canonical of [
      'candidateNumber',
      'phoneId',
      'requisitionId',
      'applicationId',
      'offerId',
      'scheduleId',
    ]) {
      const pair = fields.filter((field) => field.canonicalParamId === canonical)
      expect(pair.map((field) => field.mode).sort()).toEqual(['advanced', 'basic'])
      expect(pair[0].required).toEqual(pair[1].required)
      expect(fields.some((field) => field.id === canonical)).toBe(false)
    }
  })

  it('normalizes empty optional values after the executor merges inputs', () => {
    const map = OracleFusionRecruitingBlock.tools.config.params
    if (!map) throw new Error('Expected mapping')
    const raw = {
      operation: 'list_candidates',
      accessToken: 'token',
      instanceUrl: 'https://example.fa.ocs.oraclecloud.com',
      search: null,
      limit: '',
      offset: null,
    }
    expect(listCandidatesSchema.parse({ ...raw, ...map(raw) })).toMatchObject({
      search: undefined,
      limit: undefined,
      offset: undefined,
    })
    for (const offset of [false, 'many']) {
      const input = { ...raw, offset }
      expect(listCandidatesSchema.safeParse({ ...input, ...map(input) }).success).toBe(false)
    }
  })

  it('parses write bodies at runtime without rounding string IDs', () => {
    const map = OracleFusionRecruitingBlock.tools.config.params
    if (!map) throw new Error('Expected mapping')
    expect(
      map({
        operation: 'update_requisition',
        requisitionBody: '{"RecruiterId":"9007199254740993"}',
      })
    ).toMatchObject({ body: { RecruiterId: '9007199254740993' } })
  })
})
