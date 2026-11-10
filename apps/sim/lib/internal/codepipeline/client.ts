import { CodePipelineClient } from '@aws-sdk/client-codepipeline'
import { awsClientCredentials } from '@/lib/internal/aws/credentials'

export interface CodePipelineConnectionConfig {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export function createCodePipelineClient(config: CodePipelineConnectionConfig): CodePipelineClient {
  return new CodePipelineClient({
    region: config.region,
    credentials: awsClientCredentials(config.accessKeyId, config.secretAccessKey),
  })
}
