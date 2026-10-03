import { AthenaClient } from '@aws-sdk/client-athena'

export interface AthenaConnectionConfig {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export function createAthenaClient(config: AthenaConnectionConfig): AthenaClient {
  return new AthenaClient({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}
