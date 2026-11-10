/** Real runtime probe invoked by environment-proxy.server.test.ts against its local proxy. */
import { ListBucketsCommand, S3Client } from '@aws-sdk/client-s3'
import { awsRequestHandler } from '@/lib/core/network/proxy-agent.server'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'

const response = await secureFetchWithValidation(
  'https://1.1.1.1/.well-known/openid-configuration',
  { profile: 'contentFetch', timeout: 10_000 }
)
if (response.headers.get('x-via-proxy') !== 'yes') throw new Error('Guarded fetch bypassed proxy')
if ((await response.text()) !== 'tls reached') throw new Error('Guarded fetch response mismatch')

const buckets = await new S3Client({
  region: 'us-east-1',
  endpoint: 'https://1.1.1.1',
  forcePathStyle: true,
  credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' },
  requestHandler: awsRequestHandler(),
}).send(new ListBucketsCommand({}))
if (!Array.isArray(buckets.Buckets)) throw new Error('AWS SDK response mismatch')
process.exit(0)
