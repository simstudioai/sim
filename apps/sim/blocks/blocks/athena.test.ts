import { describe, expect, it } from 'vitest'
import { AthenaBlock } from '@/blocks/blocks/athena'

/**
 * An agent tool call sends model args under the tool's param names (`workGroup`, `queryStatement`,
 * `name`) with the operation only on `context`; the handler forwards `{ ...args, ...mapped }`.
 */
const agentCall = (operation: string, args: Record<string, unknown>): Record<string, unknown> => ({
  ...args,
  ...(AthenaBlock.tools.config?.params?.(args, { operation }) ?? {}),
})

const CREDENTIALS = { awsRegion: 'us-east-1', awsAccessKeyId: 'AKIA', awsSecretAccessKey: 'secret' }

describe('AthenaBlock agent tool calls', () => {
  it('keeps the model prepared statement workgroup and statement instead of throwing', () => {
    expect(
      agentCall('create_prepared_statement', {
        ...CREDENTIALS,
        statementName: 'by_day',
        workGroup: 'primary',
        queryStatement: 'SELECT * FROM t WHERE d = ?',
        description: 'Daily rows',
      })
    ).toMatchObject({
      statementName: 'by_day',
      workGroup: 'primary',
      queryStatement: 'SELECT * FROM t WHERE d = ?',
      description: 'Daily rows',
    })
  })

  it('keeps the model catalog name and coerces maxResults on list calls', () => {
    expect(agentCall('get_data_catalog', { ...CREDENTIALS, name: 'AwsDataCatalog' })).toMatchObject(
      { name: 'AwsDataCatalog' }
    )
    expect(agentCall('list_named_queries', { ...CREDENTIALS, maxResults: '5' })).toMatchObject({
      maxResults: 5,
    })
  })
})
