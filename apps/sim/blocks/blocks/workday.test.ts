import { describe, expect, it } from 'vitest'
import { WorkdayBlock } from '@/blocks/blocks/workday'
import type { BlockToolParamsContext } from '@/blocks/types'

const mapParams = (
  inputs: Record<string, unknown>,
  context?: BlockToolParamsContext
): Record<string, unknown> => WorkdayBlock.tools.config?.params?.(inputs, context) ?? {}

/** On an agent call the stored operation reaches the mapper only on `context`, never in the args. */
describe('Workday change job mapping', () => {
  it('maps a job profile set on the tool when the operation arrives only on the context', () => {
    expect(
      mapParams({ workerId: '04345', jobProfileId: 'JP-1' }, { operation: 'change_job' })
        .newJobProfileId
    ).toBe('JP-1')
  })

  it('keeps the model newJobProfileId when the tool field is blank', () => {
    expect(
      mapParams({ workerId: '04345', newJobProfileId: 'JP-2' }, { operation: 'change_job' })
        .newJobProfileId
    ).toBe('JP-2')
  })

  it('maps the canvas job profile exactly as before', () => {
    expect(
      mapParams({ operation: 'change_job', workerId: '04345', jobProfileId: 'JP-1' })
        .newJobProfileId
    ).toBe('JP-1')
  })
})
