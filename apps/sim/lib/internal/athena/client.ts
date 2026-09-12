import { AthenaClient } from '@aws-sdk/client-athena'
import { createOutboundAwsHttpHandler } from '@/lib/core/network/aws-handler.server'

export interface AthenaConnectionConfig {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export function createAthenaClient(config: AthenaConnectionConfig): AthenaClient {
  return new AthenaClient({
    requestHandler: createOutboundAwsHttpHandler(),
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}
