import { createBlock } from '@sim/testing/factories/block.factory'
import { blocksMock } from '@sim/testing/mocks/blocks.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as blocks from '@/blocks'
import { AppConfigBlock, AppConfigV2Block } from '@/blocks/blocks/appconfig'
import { AthenaBlock, AthenaV2Block } from '@/blocks/blocks/athena'
import { CloudFormationBlock, CloudFormationV2Block } from '@/blocks/blocks/cloudformation'
import { CloudTrailBlock, CloudTrailV2Block } from '@/blocks/blocks/cloudtrail'
import { CloudWatchBlock, CloudWatchV2Block } from '@/blocks/blocks/cloudwatch'
import { CodePipelineBlock, CodePipelineV2Block } from '@/blocks/blocks/codepipeline'
import { DatabricksBlock, DatabricksV2Block } from '@/blocks/blocks/databricks'
import { DynamoDBBlock, DynamoDBV2Block } from '@/blocks/blocks/dynamodb'
import { EC2Block, EC2V2Block } from '@/blocks/blocks/ec2'
import { IAMBlock, IAMV2Block } from '@/blocks/blocks/iam'
import { IdentityCenterBlock, IdentityCenterV2Block } from '@/blocks/blocks/identity_center'
import { LambdaBlock, LambdaV2Block } from '@/blocks/blocks/lambda'
import { RDSBlock, RDSV2Block } from '@/blocks/blocks/rds'
import { S3Block, S3V2Block } from '@/blocks/blocks/s3'
import { SecretsManagerBlock, SecretsManagerV2Block } from '@/blocks/blocks/secrets_manager'
import { SESBlock, SESV2Block } from '@/blocks/blocks/ses'
import { SQSBlock, SQSV2Block } from '@/blocks/blocks/sqs'
import { SSMBlock, SSMV2Block } from '@/blocks/blocks/ssm'
import { STSBlock, STSV2Block } from '@/blocks/blocks/sts'
import { TavilyBlock, TavilyV2Block } from '@/blocks/blocks/tavily'
import { TextractBlock, TextractV2Block, TextractV3Block } from '@/blocks/blocks/textract'
import type { BlockConfig } from '@/blocks/types'
import { Serializer } from '@/serializer'
import type { BlockState } from '@/stores/workflows/workflow/types'

vi.mock('@/blocks', () => blocksMock)
// Required-field validation reads the tools' real param declarations.
vi.unmock('@/tools/metadata')

/**
 * Each legacy block that takes inline secrets, and the credential-only version
 * that succeeds it. Legacy blocks keep running exactly as they always did; the
 * successor takes only a saved credential.
 */
const VERSIONS: Array<{
  legacy: BlockConfig
  successor: BlockConfig
  secretIds: readonly string[]
}> = [
  {
    legacy: AppConfigBlock,
    successor: AppConfigV2Block,
    secretIds: ['accessKeyId', 'secretAccessKey'],
  },
  {
    legacy: AthenaBlock,
    successor: AthenaV2Block,
    secretIds: ['awsAccessKeyId', 'awsSecretAccessKey'],
  },
  {
    legacy: CloudFormationBlock,
    successor: CloudFormationV2Block,
    secretIds: ['awsAccessKeyId', 'awsSecretAccessKey'],
  },
  {
    legacy: CloudTrailBlock,
    successor: CloudTrailV2Block,
    secretIds: ['awsAccessKeyId', 'awsSecretAccessKey'],
  },
  {
    legacy: CloudWatchBlock,
    successor: CloudWatchV2Block,
    secretIds: ['awsAccessKeyId', 'awsSecretAccessKey'],
  },
  {
    legacy: CodePipelineBlock,
    successor: CodePipelineV2Block,
    secretIds: ['awsAccessKeyId', 'awsSecretAccessKey'],
  },
  { legacy: DatabricksBlock, successor: DatabricksV2Block, secretIds: ['host', 'apiKey'] },
  {
    legacy: DynamoDBBlock,
    successor: DynamoDBV2Block,
    secretIds: ['accessKeyId', 'secretAccessKey'],
  },
  { legacy: EC2Block, successor: EC2V2Block, secretIds: ['awsAccessKeyId', 'awsSecretAccessKey'] },
  { legacy: IAMBlock, successor: IAMV2Block, secretIds: ['accessKeyId', 'secretAccessKey'] },
  {
    legacy: IdentityCenterBlock,
    successor: IdentityCenterV2Block,
    secretIds: ['accessKeyId', 'secretAccessKey'],
  },
  {
    legacy: LambdaBlock,
    successor: LambdaV2Block,
    secretIds: ['awsAccessKeyId', 'awsSecretAccessKey'],
  },
  { legacy: RDSBlock, successor: RDSV2Block, secretIds: ['accessKeyId', 'secretAccessKey'] },
  { legacy: S3Block, successor: S3V2Block, secretIds: ['accessKeyId', 'secretAccessKey'] },
  {
    legacy: SecretsManagerBlock,
    successor: SecretsManagerV2Block,
    secretIds: ['accessKeyId', 'secretAccessKey'],
  },
  { legacy: SESBlock, successor: SESV2Block, secretIds: ['accessKeyId', 'secretAccessKey'] },
  { legacy: SQSBlock, successor: SQSV2Block, secretIds: ['accessKeyId', 'secretAccessKey'] },
  { legacy: SSMBlock, successor: SSMV2Block, secretIds: ['accessKeyId', 'secretAccessKey'] },
  { legacy: STSBlock, successor: STSV2Block, secretIds: ['accessKeyId', 'secretAccessKey'] },
  {
    legacy: TextractBlock,
    successor: TextractV3Block,
    secretIds: ['accessKeyId', 'secretAccessKey'],
  },
  {
    legacy: TextractV2Block,
    successor: TextractV3Block,
    secretIds: ['accessKeyId', 'secretAccessKey'],
  },
  { legacy: TavilyBlock, successor: TavilyV2Block, secretIds: ['apiKey'] },
]

function valuesFor(ids: readonly string[], prefix: string): Record<string, string> {
  return Object.fromEntries(ids.map((id) => [id, `${prefix}-${id}`]))
}

function operations(config: BlockConfig): string[] {
  const operation = config.subBlocks.find((subBlock) => subBlock.id === 'operation')
  const options =
    typeof operation?.options === 'function' ? operation.options() : operation?.options
  return options?.map((option) => option.id) ?? []
}

function firstOperation(config: BlockConfig): string | undefined {
  return operations(config)[0]
}

function fieldTitles(config: BlockConfig, ids: readonly string[]): string[] {
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

describe.each(VERSIONS)('$legacy.type legacy block', ({ legacy, secretIds }) => {
  beforeEach(() => {
    vi.spyOn(blocks, 'getBlock').mockReturnValue(legacy)
  })

  it('serializes its inline secrets exactly as before', () => {
    const params = serialize(buildBlock(legacy, valuesFor(secretIds, 'inline')))

    for (const id of secretIds) expect(params[id]).toBe(`inline-${id}`)
    expect(params.oauthCredential).toBeUndefined()
  })

  it('still requires its inline secrets', () => {
    const message = missingRequiredFields(buildBlock(legacy, {}))

    for (const title of fieldTitles(legacy, secretIds)) expect(message).toContain(title)
  })
})

describe.each(VERSIONS)('$successor.type credential-only block', ({ successor, secretIds }) => {
  beforeEach(() => {
    vi.spyOn(blocks, 'getBlock').mockReturnValue(successor)
  })

  it('requires a saved credential', () => {
    const message = missingRequiredFields(buildBlock(successor, {}))

    expect(message).toContain(fieldTitles(successor, ['credential'])[0])
  })

  it('passes validation with only a saved credential, in every operation', () => {
    for (const operation of operations(successor)) {
      const message = missingRequiredFields(
        buildBlock(successor, { operation, credential: 'cred-1' })
      )

      for (const id of secretIds) expect(message, operation).not.toContain(id)
    }
  })

  it('sends the saved credential and never inline secrets left in its state', () => {
    const params = serialize(
      buildBlock(successor, {
        credential: 'cred-1',
        ...valuesFor(secretIds, 'stale'),
      })
    )

    expect(params.oauthCredential).toBe('cred-1')
    for (const id of secretIds) expect(params[id]).toBeUndefined()
  })

  it('builds tool params without asking for inline secrets, in every operation', () => {
    for (const operation of operations(successor)) {
      const params = serialize(buildBlock(successor, { operation, credential: 'cred-1' }))
      let message = ''
      try {
        successor.tools.config?.params?.(params)
      } catch (error) {
        message = getErrorMessage(error, String(error))
      }

      // Operation fields left empty here may fail; a missing secret must not.
      expect(message, operation).not.toMatch(
        /access key|secret access|api key|token is required|host is required|cannot read properties of undefined/i
      )
    }
  })
})
