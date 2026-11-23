import { describe, expect, it } from 'vitest'
import { DynatraceBlock } from '@/blocks/blocks/dynatrace'

/**
 * An agent tool call: the stored row's values and the model's args (keyed by the tool's param
 * names) arrive merged, the operation only on `context`, and the executor forwards
 * `{ ...params, ...mapped }`.
 */
const agentCall = (
  operation: string,
  params: Record<string, unknown>
): Record<string, unknown> => ({
  ...params,
  ...(DynatraceBlock.tools.config?.params?.(params, { operation }) ?? {}),
})

describe('DynatraceBlock agent tool calls', () => {
  it('forwards the tag key and value set on the tool row to delete_tag', () => {
    const mapped = agentCall('dynatrace_delete_tag', {
      entitySelector: 'type(HOST)',
      tagKey: 'env',
      tagValue: 'prod',
    })
    expect(mapped).toMatchObject({ key: 'env', value: 'prod' })
  })

  it('keeps model args named after the tool params when the row fields are blank', () => {
    const mapped = agentCall('dynatrace_delete_tag', {
      entitySelector: 'type(HOST)',
      tagKey: '',
      tagValue: '',
      key: 'team',
      value: 'payments',
    })
    expect(mapped).toMatchObject({ key: 'team', value: 'payments' })

    const monitors = agentCall('dynatrace_list_synthetic_monitors', {
      monitorEnabled: '',
      enabled: false,
      managementZone: 42,
    })
    expect(monitors).toMatchObject({ enabled: false, managementZone: 42 })
  })
})
