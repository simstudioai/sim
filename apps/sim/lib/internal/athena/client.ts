import { AthenaClient } from '@aws-sdk/client-athena'
import { awsClientConfig } from '@/lib/internal/aws/credentials'

export interface AthenaConnectionConfig {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export function createAthenaClient(config: AthenaConnectionConfig): AthenaClient {
  return new AthenaClient({
    ...awsClientConfig(config.region, config.accessKeyId, config.secretAccessKey),
  })
}
