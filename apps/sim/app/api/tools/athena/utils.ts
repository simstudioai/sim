import { AthenaClient } from '@aws-sdk/client-athena'

interface AwsCredentials {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export function createAthenaClient(config: AwsCredentials): AthenaClient {
  return new AthenaClient({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}
