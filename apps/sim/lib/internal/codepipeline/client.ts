import { CodePipelineClient } from '@aws-sdk/client-codepipeline'
import { awsClientConfig } from '@/lib/internal/aws/credentials'

export interface CodePipelineConnectionConfig {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export function createCodePipelineClient(config: CodePipelineConnectionConfig): CodePipelineClient {
  return new CodePipelineClient({
    ...awsClientConfig(config.region, config.accessKeyId, config.secretAccessKey),
  })
}
