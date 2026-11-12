/**
 * The executor hands a tool `{ ...rawInputs, ...blockParams }`, so a subBlock value the
 * block mapper leaves unassigned reaches the tool raw. These cases keep stored values
 * from another operation, and empty table rows, out of requests.
 */
import { describe, expect, it } from 'vitest'
import { awsCloudformationCreateChangeSetContract } from '@/lib/api/contracts/tools/aws/cloudformation-create-change-set'
import { awsDynamodbScanContract } from '@/lib/api/contracts/tools/aws/dynamodb-scan'
import { awsIamCreateUserContract } from '@/lib/api/contracts/tools/aws/iam-create-user'
import { awsIamListPoliciesContract } from '@/lib/api/contracts/tools/aws/iam-list-policies'
import { awsSesSendTemplatedEmailContract } from '@/lib/api/contracts/tools/aws/ses-send-templated-email'
import { CloudFormationBlock } from '@/blocks/blocks/cloudformation'
import { DynamoDBBlock } from '@/blocks/blocks/dynamodb'
import { IAMBlock } from '@/blocks/blocks/iam'
import { SESBlock } from '@/blocks/blocks/ses'
import type { BlockConfig } from '@/blocks/types'
import { createChangeSetTool } from '@/tools/cloudformation/create_change_set'
import { scanTool } from '@/tools/dynamodb/scan'
import { createUserTool } from '@/tools/iam/create_user'
import { listPoliciesTool } from '@/tools/iam/list_policies'
import { sendTemplatedEmailTool } from '@/tools/ses/send_templated_email'

const AWS = { region: 'us-east-1', accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secret' }

function executorParams(block: BlockConfig, inputs: Record<string, unknown>) {
  const mapped = block.tools.config?.params?.(inputs) ?? {}
  return { ...inputs, ...mapped } as Record<string, unknown>
}

describe('AWS blocks keep stale subBlock values out of tool input', () => {
  it('scan ignores the get consistentRead and query indexName values', () => {
    const params = executorParams(DynamoDBBlock, {
      ...AWS,
      operation: 'scan',
      tableName: 'orders',
      consistentRead: 'false',
      indexName: 'by-customer',
    })
    const body = scanTool.operation.input(params as never) as Record<string, unknown>
    expect(body.indexName).toBeUndefined()
    expect(awsDynamodbScanContract.body?.safeParse(body).success).toBe(true)
  })

  it('templated send ignores the send_email Reply-To', () => {
    const params = executorParams(SESBlock, {
      ...AWS,
      operation: 'send_templated_email',
      fromAddress: 'from@example.com',
      toAddresses: 'to@example.com',
      templateName: 'welcome',
      templateData: '{}',
      replyToAddresses: 'stale@example.com',
    })
    const body = sendTemplatedEmailTool.operation.input(params as never) as Record<string, unknown>
    expect(body.replyToAddresses).toBeUndefined()
    expect(awsSesSendTemplatedEmailContract.body?.safeParse(body).success).toBe(true)
  })

  it('create change set ignores the stack tags', () => {
    const params = executorParams(CloudFormationBlock, {
      awsRegion: 'us-east-1',
      awsAccessKeyId: 'AKIAEXAMPLE',
      awsSecretAccessKey: 'secret',
      operation: 'create_change_set',
      stackName: 'app',
      changeSetName: 'cs-1',
      templateBody: '{}',
      tags: '[{"key":"team","value":"old"}]',
    })
    const body = createChangeSetTool.operation.input(params as never) as Record<string, unknown>
    expect(body.tags).toBeUndefined()
    expect(awsCloudformationCreateChangeSetContract.body?.safeParse(body).success).toBe(true)
  })

  it('create user accepts an untouched Tags table', () => {
    const params = executorParams(IAMBlock, {
      ...AWS,
      operation: 'create_user',
      userName: 'alice',
      tags: [{ id: 'row-1', cells: { key: '', value: '' } }],
    })
    const body = createUserTool.operation.input(params as never)
    expect(awsIamCreateUserContract.body?.safeParse(body).success).toBe(true)
  })

  it('list policies with the All usage filter sends no filter', () => {
    const params = executorParams(IAMBlock, {
      ...AWS,
      operation: 'list_policies',
      policyUsageFilter: 'all',
    })
    const body = listPoliciesTool.operation.input(params as never) as Record<string, unknown>
    expect(body.policyUsageFilter).toBeUndefined()
    expect(awsIamListPoliciesContract.body?.safeParse(body).success).toBe(true)
  })

  it('create user rejects a JSON-array tags string with no valid entries', () => {
    expect(() =>
      executorParams(IAMBlock, {
        ...AWS,
        operation: 'create_user',
        userName: 'alice',
        tags: '[{"name":"team","val":"core"}]',
      })
    ).toThrow('Tags must be a list of {"key", "value"} entries or a JSON object')
  })
})
