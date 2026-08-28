import { CodePipelineClient } from '@aws-sdk/client-codepipeline'

export interface CodePipelineConnectionConfig {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export function createCodePipelineClient(config: CodePipelineConnectionConfig): CodePipelineClient {
  return new CodePipelineClient({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}
