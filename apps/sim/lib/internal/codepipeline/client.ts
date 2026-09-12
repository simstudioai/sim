import { CodePipelineClient } from '@aws-sdk/client-codepipeline'
import { createOutboundAwsHttpHandler } from '@/lib/core/network/aws-handler.server'

export interface CodePipelineConnectionConfig {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export function createCodePipelineClient(config: CodePipelineConnectionConfig): CodePipelineClient {
  return new CodePipelineClient({
    requestHandler: createOutboundAwsHttpHandler(),
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}
