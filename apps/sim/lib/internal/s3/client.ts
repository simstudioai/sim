import { S3Client } from '@aws-sdk/client-s3'

export interface S3ConnectionConfig {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export function createS3Client(config: S3ConnectionConfig): S3Client {
  return new S3Client({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}
