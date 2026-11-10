import { AthenaClient } from '@aws-sdk/client-athena'
import { awsClientCredentials } from '@/lib/internal/aws/credentials'

export interface AthenaConnectionConfig {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export function createAthenaClient(config: AthenaConnectionConfig): AthenaClient {
  return new AthenaClient({
    region: config.region,
    credentials: awsClientCredentials(config.accessKeyId, config.secretAccessKey),
  })
}
