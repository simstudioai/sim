import { createBlock } from '@sim/testing/factories/block.factory'
import { blocksMock } from '@sim/testing/mocks/blocks.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as blocks from '@/blocks'
import { AppConfigBlock } from '@/blocks/blocks/appconfig'
import { AthenaBlock } from '@/blocks/blocks/athena'
import { CloudFormationBlock } from '@/blocks/blocks/cloudformation'
import { CloudTrailBlock } from '@/blocks/blocks/cloudtrail'
import { CloudWatchBlock } from '@/blocks/blocks/cloudwatch'
import { CodePipelineBlock } from '@/blocks/blocks/codepipeline'
import { DatabricksBlock } from '@/blocks/blocks/databricks'
import { DynamoDBBlock } from '@/blocks/blocks/dynamodb'
import { EC2Block } from '@/blocks/blocks/ec2'
import { IAMBlock } from '@/blocks/blocks/iam'
import { IdentityCenterBlock } from '@/blocks/blocks/identity_center'
import { LambdaBlock } from '@/blocks/blocks/lambda'
import { RDSBlock } from '@/blocks/blocks/rds'
import { S3Block } from '@/blocks/blocks/s3'
import { SecretsManagerBlock } from '@/blocks/blocks/secrets_manager'
import { SESBlock } from '@/blocks/blocks/ses'
import { SQSBlock } from '@/blocks/blocks/sqs'
import { SSMBlock } from '@/blocks/blocks/ssm'
import { STSBlock } from '@/blocks/blocks/sts'
import { TextractBlock, TextractV2Block } from '@/blocks/blocks/textract'
import type { BlockConfig } from '@/blocks/types'
import { Serializer } from '@/serializer'
import type { BlockState } from '@/stores/workflows/workflow/types'

vi.mock('@/blocks', () => blocksMock)

/**
 * Blocks that accept a saved credential while keeping their inline secret
 * fields. The contract every one of them must keep: a block saved before the
 * credential option existed — inline secrets, no credential — serializes and
 * validates exactly as it always did.
 */
const HYBRID_BLOCKS: Array<{ block: BlockConfig; secretIds: [string, string] }> = [
  { block: AppConfigBlock, secretIds: ['accessKeyId', 'secretAccessKey'] },
  { block: AthenaBlock, secretIds: ['awsAccessKeyId', 'awsSecretAccessKey'] },
  { block: CloudFormationBlock, secretIds: ['awsAccessKeyId', 'awsSecretAccessKey'] },
  { block: CloudTrailBlock, secretIds: ['awsAccessKeyId', 'awsSecretAccessKey'] },
  { block: CloudWatchBlock, secretIds: ['awsAccessKeyId', 'awsSecretAccessKey'] },
  { block: CodePipelineBlock, secretIds: ['awsAccessKeyId', 'awsSecretAccessKey'] },
  { block: DynamoDBBlock, secretIds: ['accessKeyId', 'secretAccessKey'] },
  { block: EC2Block, secretIds: ['awsAccessKeyId', 'awsSecretAccessKey'] },
  { block: IAMBlock, secretIds: ['accessKeyId', 'secretAccessKey'] },
  { block: IdentityCenterBlock, secretIds: ['accessKeyId', 'secretAccessKey'] },
  { block: LambdaBlock, secretIds: ['awsAccessKeyId', 'awsSecretAccessKey'] },
  { block: RDSBlock, secretIds: ['accessKeyId', 'secretAccessKey'] },
  { block: S3Block, secretIds: ['accessKeyId', 'secretAccessKey'] },
  { block: SecretsManagerBlock, secretIds: ['accessKeyId', 'secretAccessKey'] },
  { block: SESBlock, secretIds: ['accessKeyId', 'secretAccessKey'] },
  { block: SQSBlock, secretIds: ['accessKeyId', 'secretAccessKey'] },
  { block: SSMBlock, secretIds: ['accessKeyId', 'secretAccessKey'] },
  { block: STSBlock, secretIds: ['accessKeyId', 'secretAccessKey'] },
  { block: TextractBlock, secretIds: ['accessKeyId', 'secretAccessKey'] },
  { block: TextractV2Block, secretIds: ['accessKeyId', 'secretAccessKey'] },
  { block: DatabricksBlock, secretIds: ['host', 'apiKey'] },
]

function firstOperation(config: BlockConfig): string | undefined {
  const operation = config.subBlocks.find((subBlock) => subBlock.id === 'operation')
  const options =
    typeof operation?.options === 'function' ? operation.options() : operation?.options
  return options?.[0]?.id
}

function secretTitles(config: BlockConfig, ids: readonly string[]): string[] {
  return config.subBlocks
    .filter((subBlock) => ids.includes(subBlock.id))
    .map((subBlock) => subBlock.title ?? subBlock.id)
}

function buildBlock(config: BlockConfig, values: Record<string, string>): BlockState {
  const operation = firstOperation(config)
  const all: Record<string, string> = { ...(operation ? { operation } : {}), ...values }
  return createBlock({
    type: config.type,
    name: config.name,
    subBlocks: Object.fromEntries(
      Object.entries(all).map(([id, value]) => [id, { id, type: 'short-input', value }])
    ),
  })
}

function serialize(block: BlockState) {
  return new Serializer().serializeWorkflow({ [block.id]: block }, [], {}, {}, false).blocks[0]
    .config.params
}

function missingRequiredFields(block: BlockState): string {
  try {
    new Serializer().serializeWorkflow({ [block.id]: block }, [], {}, {}, true)
    return ''
  } catch (error) {
    return getErrorMessage(error, String(error))
  }
}

describe.each(HYBRID_BLOCKS)('$block.type saved-credential hybrid', ({ block, secretIds }) => {
  beforeEach(() => {
    vi.spyOn(blocks, 'getBlock').mockReturnValue(block)
  })

  it('serializes a block saved with inline secrets exactly as before', () => {
    const params = serialize(
      buildBlock(block, { [secretIds[0]]: 'inline-one', [secretIds[1]]: 'inline-two' })
    )

    expect(params[secretIds[0]]).toBe('inline-one')
    expect(params[secretIds[1]]).toBe('inline-two')
    expect(params.oauthCredential).toBeUndefined()
  })

  it('still requires the inline secrets when no saved credential is selected', () => {
    const message = missingRequiredFields(buildBlock(block, {}))

    for (const title of secretTitles(block, secretIds)) expect(message).toContain(title)
  })

  it('stops requiring the inline secrets once a saved credential is selected', () => {
    const message = missingRequiredFields(buildBlock(block, { credential: 'cred-1' }))

    for (const title of secretTitles(block, secretIds)) expect(message).not.toContain(title)
  })

  it('uses the saved credential instead of stale inline secrets', () => {
    const params = serialize(
      buildBlock(block, {
        credential: 'cred-1',
        [secretIds[0]]: 'stale-one',
        [secretIds[1]]: 'stale-two',
      })
    )

    expect(params.oauthCredential).toBe('cred-1')
    expect(params[secretIds[0]]).toBeUndefined()
    expect(params[secretIds[1]]).toBeUndefined()
  })
})
