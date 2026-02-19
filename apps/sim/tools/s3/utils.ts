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

export function parseS3Uri(
  s3Uri: string,
  fallbackRegion?: string
): {
  bucketName: string
  region: string
  objectKey: string
} {
  try {
    const url = new URL(s3Uri)
    const hostname = url.hostname
    const normalizedPath = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname

    const virtualHostedDualstackMatch = hostname.match(
      /^(.+)\.s3\.dualstack\.([^.]+)\.amazonaws\.com(?:\.cn)?$/
    )
    const virtualHostedRegionalMatch = hostname.match(
      /^(.+)\.s3[.-]([^.]+)\.amazonaws\.com(?:\.cn)?$/
    )
    const virtualHostedGlobalMatch = hostname.match(/^(.+)\.s3\.amazonaws\.com(?:\.cn)?$/)

    const pathStyleDualstackMatch = hostname.match(
      /^s3\.dualstack\.([^.]+)\.amazonaws\.com(?:\.cn)?$/
    )
    const pathStyleRegionalMatch = hostname.match(/^s3[.-]([^.]+)\.amazonaws\.com(?:\.cn)?$/)
    const pathStyleGlobalMatch = hostname.match(/^s3\.amazonaws\.com(?:\.cn)?$/)

    const isPathStyleHost = Boolean(
      pathStyleDualstackMatch || pathStyleRegionalMatch || pathStyleGlobalMatch
    )

    const firstSlashIndex = normalizedPath.indexOf('/')
    const pathStyleBucketName =
      firstSlashIndex === -1 ? normalizedPath : normalizedPath.slice(0, firstSlashIndex)
    const pathStyleObjectKey =
      firstSlashIndex === -1 ? '' : normalizedPath.slice(firstSlashIndex + 1)

    const bucketName = isPathStyleHost
      ? pathStyleBucketName
      : (virtualHostedDualstackMatch?.[1] ??
        virtualHostedRegionalMatch?.[1] ??
        virtualHostedGlobalMatch?.[1] ??
        '')

    const rawObjectKey = isPathStyleHost ? pathStyleObjectKey : normalizedPath
    const objectKey = (() => {
      try {
        return decodeURIComponent(rawObjectKey)
      } catch {
        return rawObjectKey
      }
    })()

    const normalizedFallbackRegion = fallbackRegion?.trim()
    const regionFromHost =
      virtualHostedDualstackMatch?.[2] ??
      virtualHostedRegionalMatch?.[2] ??
      pathStyleDualstackMatch?.[1] ??
      pathStyleRegionalMatch?.[1]
    const region = regionFromHost || normalizedFallbackRegion || 'us-east-1'

    if (!bucketName || !objectKey) {
      throw new Error('Invalid S3 URI format')
    }

    return { bucketName, region, objectKey }
  } catch (_error) {
    throw new Error(
      'Invalid S3 Object URL format. Expected S3 virtual-hosted or path-style URL with object key.'
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
