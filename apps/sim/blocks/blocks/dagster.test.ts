/**
 * An Agent tool call runs the block mapper over `{ ...storedRowParams, ...modelArgs }` with the
 * operation only in `context`; the tool then receives `{ ...merged, ...mapped }`.
 */
import { describe, expect, it } from 'vitest'
import { DagsterBlock } from '@/blocks/blocks/dagster'
import { materializeAssetsTool } from '@/tools/dagster/materialize_assets'
import { reportAssetMaterializationTool } from '@/tools/dagster/report_asset_materialization'

function materializeVariables(args: Record<string, unknown>) {
  const mapped =
    DagsterBlock.tools.config?.params?.(args, { operation: 'materialize_assets' }) ?? {}
  const body = materializeAssetsTool.request.body
  if (typeof body !== 'function') throw new Error('materialize_assets has no body builder')
  return (body({ ...args, ...mapped } as never) as { variables: Record<string, unknown> }).variables
}

const BASE_ARGS = {
  host: 'https://dagster.example.com',
  repositoryLocationName: 'loc',
  repositoryName: 'repo',
  assetSelection: 'orders',
}

describe('Dagster materialize assets on an Agent tool call', () => {
  it('sends the job name stored on the tool row', () => {
    expect(materializeVariables({ ...BASE_ARGS, assetJobName: 'stored_job' }).jobName).toBe(
      'stored_job'
    )
  })

  it('keeps the job name the model supplied', () => {
    expect(materializeVariables({ ...BASE_ARGS, jobName: 'model_job' }).jobName).toBe('model_job')
  })
})

function reportedEventType(args: Record<string, unknown>) {
  const mapped =
    DagsterBlock.tools.config?.params?.(args, { operation: 'report_asset_materialization' }) ?? {}
  const body = reportAssetMaterializationTool.request.body
  if (typeof body !== 'function')
    throw new Error('report_asset_materialization has no body builder')
  const { variables } = body({ ...args, ...mapped } as never) as {
    variables: { eventParams: { eventType: unknown } }
  }
  return variables.eventParams.eventType
}

describe('Dagster report asset event on an Agent tool call', () => {
  it('keeps the event type the model supplied over the seeded dropdown default', () => {
    expect(
      reportedEventType({
        host: 'https://dagster.example.com',
        assetKey: 'orders',
        reportEventType: 'ASSET_MATERIALIZATION',
        eventType: 'ASSET_OBSERVATION',
      })
    ).toBe('ASSET_OBSERVATION')
  })
})
