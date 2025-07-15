import crypto from 'crypto'
import type { ToolConfig } from '../types'
import { encodeS3PathComponent, generatePresignedUrl, getSignatureKey, parseS3Uri } from './utils'

export const s3GetObjectTool: ToolConfig = {
  id: 's3_get_object',
  name: 'S3 Get Object',
  description: 'Retrieve an object from an AWS S3 bucket',
  version: '2.0.0',
  params: {
    accessKeyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your AWS Access Key ID',
    },
    secretAccessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your AWS Secret Access Key',
    },
    s3Uri: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'S3 Object URL (e.g., https://bucket-name.s3.region.amazonaws.com/path/to/file)',
    },
  },
  request: {
    url: (params) => {
      try {
        const { bucketName, region, objectKey } = parseS3Uri(params.s3Uri)

        params.bucketName = bucketName
        params.region = region
        params.objectKey = objectKey

        return `https://${bucketName}.s3.${region}.amazonaws.com/${encodeS3PathComponent(objectKey)}`
      } catch (_error) {
        throw new Error(
          'Invalid S3 Object URL format. Expected format: https://bucket-name.s3.region.amazonaws.com/path/to/file'
        )
      }
    },
    method: 'HEAD',
    headers: (params) => {
      try {
        // Parse S3 URI if not already parsed
        if (!params.bucketName || !params.region || !params.objectKey) {
          const { bucketName, region, objectKey } = parseS3Uri(params.s3Uri)
          params.bucketName = bucketName
          params.region = region
          params.objectKey = objectKey
        }

        // Use UTC time explicitly
        const date = new Date()
        const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '')
        const dateStamp = amzDate.slice(0, 8)

        const method = 'HEAD'
        const encodedPath = encodeS3PathComponent(params.objectKey)
        const canonicalUri = `/${encodedPath}`
        const canonicalQueryString = ''
        const payloadHash = crypto.createHash('sha256').update('').digest('hex')
        const host = `${params.bucketName}.s3.${params.region}.amazonaws.com`
        const canonicalHeaders =
          `host:${host}\n` + `x-amz-content-sha256:${payloadHash}\n` + `x-amz-date:${amzDate}\n`
        const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
        const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`

        const algorithm = 'AWS4-HMAC-SHA256'
        const credentialScope = `${dateStamp}/${params.region}/s3/aws4_request`
        const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${crypto.createHash('sha256').update(canonicalRequest).digest('hex')}`

        const signingKey = getSignatureKey(params.secretAccessKey, dateStamp, params.region, 's3')
        const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')

        const authorizationHeader = `${algorithm} Credential=${params.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

        return {
          Host: host,
          'X-Amz-Content-Sha256': payloadHash,
          'X-Amz-Date': amzDate,
          Authorization: authorizationHeader,
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        throw new Error(`Failed to generate request headers: ${errorMessage}`)
      }
    },
  },
  transformResponse: async (response: Response, params) => {
    try {
      if (!response.ok) {
        throw new Error(`S3 request failed: ${response.status} ${response.statusText}`)
      }

      // Parse S3 URI if not already parsed
      if (!params.bucketName || !params.region || !params.objectKey) {
        const { bucketName, region, objectKey } = parseS3Uri(params.s3Uri)
        params.bucketName = bucketName
        params.region = region
        params.objectKey = objectKey
      }

      // Get file metadata
      const contentType = response.headers.get('content-type') || 'application/octet-stream'
      const contentLength = Number.parseInt(response.headers.get('content-length') || '0', 10)
      const lastModified = response.headers.get('last-modified') || new Date().toISOString()
      const fileName = params.objectKey.split('/').pop() || params.objectKey

      // Generate pre-signed URL for download
      const url = generatePresignedUrl(params, 3600)

      return {
        success: true,
        output: {
          url,
          metadata: {
            fileType: contentType,
            size: contentLength,
            name: fileName,
            lastModified: lastModified,
          },
        },
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      return {
        success: false,
        output: {
          url: '',
          metadata: {
            fileType: 'error',
            size: 0,
            name: params.objectKey?.split('/').pop() || 'unknown',
            error: errorMessage,
          },
        },
      }
    }
  },
}
