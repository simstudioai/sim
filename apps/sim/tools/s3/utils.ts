import crypto from 'crypto'

export function encodeS3PathComponent(pathComponent: string): string {
  return encodeURIComponent(pathComponent).replace(/%2F/g, '/')
}

export function getSignatureKey(
  key: string,
  dateStamp: string,
  regionName: string,
  serviceName: string
): Buffer {
  if (!key || typeof key !== 'string') {
    throw new Error('Invalid key provided to getSignatureKey')
  }
  const kDate = crypto.createHmac('sha256', `AWS4${key}`).update(dateStamp).digest()
  const kRegion = crypto.createHmac('sha256', kDate).update(regionName).digest()
  const kService = crypto.createHmac('sha256', kRegion).update(serviceName).digest()
  const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest()
  return kSigning
}

export function parseS3Uri(s3Uri: string): {
  bucketName: string
  region: string
  objectKey: string
} {
  try {
    const url = new URL(s3Uri)
    const hostname = url.hostname
    const bucketName = hostname.split('.')[0]
    const regionMatch = hostname.match(/s3[.-]([^.]+)\.amazonaws\.com/)
    const region = regionMatch ? regionMatch[1] : 'us-east-1'
    const objectKey = url.pathname.startsWith('/') ? url.pathname.substring(1) : url.pathname

    if (!bucketName || !objectKey) {
      throw new Error('Invalid S3 URI format')
    }

    return { bucketName, region, objectKey }
  } catch (_error) {
    throw new Error(
      'Invalid S3 Object URL format. Expected format: https://bucket-name.s3.region.amazonaws.com/path/to/file'
    )
  }
}

export function generatePresignedUrl(params: any, expiresIn = 3600): string {
  const date = new Date()
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const encodedPath = encodeS3PathComponent(params.objectKey)

  const _expires = Math.floor(Date.now() / 1000) + expiresIn

  const method = 'GET'
  const canonicalUri = `/${encodedPath}`
  const canonicalQueryString = `X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=${encodeURIComponent(`${params.accessKeyId}/${dateStamp}/${params.region}/s3/aws4_request`)}&X-Amz-Date=${amzDate}&X-Amz-Expires=${expiresIn}&X-Amz-SignedHeaders=host`
  const canonicalHeaders = `host:${params.bucketName}.s3.${params.region}.amazonaws.com\n`
  const signedHeaders = 'host'
  const payloadHash = 'UNSIGNED-PAYLOAD'

  const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`

  const algorithm = 'AWS4-HMAC-SHA256'
  const credentialScope = `${dateStamp}/${params.region}/s3/aws4_request`
  const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${crypto.createHash('sha256').update(canonicalRequest).digest('hex')}`

  const signingKey = getSignatureKey(params.secretAccessKey, dateStamp, params.region, 's3')
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')

  return `https://${params.bucketName}.s3.${params.region}.amazonaws.com/${encodedPath}?${canonicalQueryString}&X-Amz-Signature=${signature}`
}
