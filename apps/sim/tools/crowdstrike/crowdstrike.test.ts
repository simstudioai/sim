/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { crowdstrikeQueryBodySchema } from '@/lib/api/contracts/tools/crowdstrike'
import { CrowdStrikeBlock } from '@/blocks/blocks/crowdstrike'
import { crowdstrikeCreateIndicatorsTool } from '@/tools/crowdstrike/create_indicators'
import { crowdstrikeExecuteRtrCommandTool } from '@/tools/crowdstrike/execute_rtr_command'
import { crowdstrikeGetSensorAggregatesTool } from '@/tools/crowdstrike/get_sensor_aggregates'
import { crowdstrikeGetSensorDetailsTool } from '@/tools/crowdstrike/get_sensor_details'
import { crowdstrikeQueryAlertsTool } from '@/tools/crowdstrike/query_alerts'
import { crowdstrikeQueryIndicatorsTool } from '@/tools/crowdstrike/query_indicators'
import { crowdstrikeQuerySensorsTool } from '@/tools/crowdstrike/query_sensors'
import type {
  CrowdStrikeGetSensorAggregatesResponse,
  CrowdStrikeGetSensorDetailsResponse,
  CrowdStrikeQuerySensorsResponse,
} from '@/tools/crowdstrike/types'
import { crowdstrikeUpdateIndicatorsTool } from '@/tools/crowdstrike/update_indicators'

const credentials = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  cloud: 'us-1' as const,
}

function issueMessages(result: ReturnType<typeof crowdstrikeQueryBodySchema.safeParse>) {
  return result.success ? [] : result.error.issues.map((issue) => issue.message)
}

describe('CrowdStrike indicator batch cap', () => {
  const oversizedIndicators = {
    crowdstrike_create_indicators: Array.from({ length: 201 }, (_, index) => ({
      type: 'sha256',
      value: `value-${index}`,
      applied_globally: true,
    })),
    crowdstrike_update_indicators: Array.from({ length: 201 }, (_, index) => ({
      id: `ioc-${index}`,
      action: 'prevent',
    })),
  } as const

  it('attributes the 200-indicator cap to Sim rather than to CrowdStrike', () => {
    for (const operation of [
      'crowdstrike_create_indicators',
      'crowdstrike_update_indicators',
    ] as const) {
      const messages = issueMessages(
        crowdstrikeQueryBodySchema.safeParse({
          ...credentials,
          operation,
          indicators: oversizedIndicators[operation],
        })
      )

      expect(messages).toContain(
        'Sim caps this request at 200 indicators; CrowdStrike publishes no limit for this endpoint'
      )
      expect(messages.join('\n')).not.toMatch(/CrowdStrike accepts at most 200 indicators/)
    }
  })
})

describe('CrowdStrike update-indicators guidance', () => {
  it('states the omitted-field hazard as observed rather than as documented behavior', () => {
    const { description } = crowdstrikeUpdateIndicatorsTool
    expect(description).not.toMatch(/blanks out any field you omit/)
    expect(description).toMatch(/omitted fields may be cleared/)
    expect(description).toMatch(/resend its full field set/)

    const indicatorsParam = crowdstrikeUpdateIndicatorsTool.params.indicators
    expect(indicatorsParam.description).not.toMatch(/blanks out any updatable field/)
    expect(indicatorsParam.description).toMatch(/may be cleared/)
  })
})

describe('CrowdStrike alerts API lineage', () => {
  it('calls the Detects API decommissioned, not deprecated', () => {
    expect(crowdstrikeQueryAlertsTool.description).not.toMatch(/deprecated Detects API/)
    expect(crowdstrikeQueryAlertsTool.description).toMatch(/decommissioned on September 30, 2025/)
  })
})

describe('CrowdStrike sensor outputs', () => {
  it('declares pagination on every sensor-listing tool', () => {
    expect(crowdstrikeQuerySensorsTool.outputs.pagination).toBeDefined()
    expect(crowdstrikeGetSensorDetailsTool.outputs.pagination).toBeDefined()
  })

  it('declares errors on every sensor tool', () => {
    expect(crowdstrikeQuerySensorsTool.outputs.errors).toBeDefined()
    expect(crowdstrikeGetSensorDetailsTool.outputs.errors).toBeDefined()
    expect(crowdstrikeGetSensorAggregatesTool.outputs.errors).toBeDefined()
  })

  /**
   * The route emits `errors` on all three sensor envelopes and the contract requires
   * it, so the response interfaces must carry it too. Interfaces are erased at
   * runtime, so these literals are the check: dropping `errors` from any of the
   * three makes them a compile error (TS2353) in the editor and in any `tsc` run
   * that includes test files. `apps/sim/tsconfig.json` excludes test files, so
   * `bun run type-check` alone will not catch it.
   */
  it('types errors on every sensor response interface', () => {
    const querySensors: CrowdStrikeQuerySensorsResponse['output'] = {
      count: 0,
      errors: [],
      pagination: null,
      sensors: [],
    }
    const sensorDetails: CrowdStrikeGetSensorDetailsResponse['output'] = {
      count: 0,
      errors: [],
      pagination: null,
      sensors: [],
    }
    const sensorAggregates: CrowdStrikeGetSensorAggregatesResponse['output'] = {
      aggregates: [],
      count: 0,
      errors: [],
    }

    expect(querySensors.errors).toEqual([])
    expect(sensorDetails.errors).toEqual([])
    expect(sensorAggregates.errors).toEqual([])
  })
})

describe('CrowdStrike RTR read-only base commands', () => {
  function parseBaseCommand(baseCommand: string) {
    return crowdstrikeQueryBodySchema.safeParse({
      ...credentials,
      operation: 'crowdstrike_execute_rtr_command',
      sessionId: 'session-1',
      baseCommand,
      commandString: `${baseCommand} `,
    })
  }

  it('accepts the non-Windows network and session triage commands', () => {
    expect(parseBaseCommand('ifconfig').success).toBe(true)
    expect(parseBaseCommand('users').success).toBe(true)
  })

  it('keeps the read-tier commands PSFalcon and Caracara document', () => {
    for (const baseCommand of ['csrutil', 'reg', 'eventlog']) {
      expect(parseBaseCommand(baseCommand).success).toBe(true)
    }
  })

  it('still rejects a write-tier base command', () => {
    expect(parseBaseCommand('rm').success).toBe(false)
  })

  it('documents that only reg query is read-tier', () => {
    expect(crowdstrikeExecuteRtrCommandTool.params.baseCommand.description).toMatch(
      /only reg query is read-tier/
    )
  })

  it('offers ifconfig and users in the block dropdown', () => {
    const baseCommandBlock = CrowdStrikeBlock.subBlocks.find((block) => block.id === 'baseCommand')
    const optionIds = (baseCommandBlock?.options as { id: string }[] | undefined)?.map(
      (option) => option.id
    )
    expect(optionIds).toContain('ifconfig')
    expect(optionIds).toContain('users')
  })
})

describe('CrowdStrike sort placeholders', () => {
  const sortBlocks = CrowdStrikeBlock.subBlocks.filter((block) => block.id === 'sort')

  function placeholderFor(operation: string) {
    const match = sortBlocks.find((block) => {
      const declared = (block.condition as { value: string | string[] }).value
      return Array.isArray(declared) ? declared.includes(operation) : declared === operation
    })
    return match?.placeholder
  }

  it('shows the dot form for the collections that document it and the pipe form elsewhere', () => {
    expect(sortBlocks).toHaveLength(3)

    for (const operation of ['crowdstrike_query_host_groups', 'crowdstrike_query_sensors']) {
      expect(placeholderFor(operation)).toBe('name.asc')
    }

    for (const operation of [
      'crowdstrike_query_alerts',
      'crowdstrike_query_vulnerabilities',
      'crowdstrike_query_cases',
    ]) {
      expect(placeholderFor(operation)).toBe('created_timestamp|desc')
    }
  })

  it('steers IOC Management to the dot form and away from created_timestamp', () => {
    // PSFalcon's Get-FalconIoc -Sort ValidateSet is the dot form, and the IOC
    // sort enum has no created_timestamp - the timestamp fields are created_on
    // and modified_on. The pipe form here sent users toward a sort Falcon rejects.
    const placeholder = placeholderFor('crowdstrike_query_indicators')
    expect(placeholder).toBe('created_on.desc')
    expect(placeholder).not.toContain('|')
    expect(placeholder).not.toContain('created_timestamp')
  })
})

describe('CrowdStrike limit caps name their real source', () => {
  it('does not attribute the IOC indicator cap to CrowdStrike', () => {
    // GET /iocs/queries/indicators/v1 publishes no `maximum`, unlike host groups
    // (5000) and Spotlight (400), and PSFalcon clamps to 2000 on its own.
    const messages = issueMessages(
      crowdstrikeQueryBodySchema.safeParse({
        ...credentials,
        operation: 'crowdstrike_query_indicators',
        limit: 501,
      })
    )

    expect(
      messages.some((message) => /Sim caps this request at 500 indicators/.test(message))
    ).toBe(true)
    expect(messages.some((message) => /CrowdStrike accepts at most 500/.test(message))).toBe(false)
    expect(crowdstrikeQueryIndicatorsTool.params.limit.description).toMatch(
      /Sim caps it at 500|publishes no maximum/i
    )
  })

  it('still accepts a documented cap at its published maximum', () => {
    expect(
      crowdstrikeQueryBodySchema.safeParse({
        ...credentials,
        operation: 'crowdstrike_query_vulnerabilities',
        filter: "status:'open'",
        limit: 400,
      }).success
    ).toBe(true)
  })
})

describe('CrowdStrike IOC action list stays inside what CrowdStrike documents', () => {
  it('does not present prevent_no_ui as a documented action value', () => {
    const description = crowdstrikeCreateIndicatorsTool.params.indicators.description ?? ''
    expect(description).toMatch(/no_action, allow, prevent, detect/)
    expect(description).not.toMatch(/allow, prevent_no_ui, prevent/)
    expect(description).toMatch(/\/iocs\/queries\/actions\/v1/)
  })
})
