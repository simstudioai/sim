import crypto from 'crypto'
import {
  encodeS3PathComponent,
  generatePresignedUrl,
  getSignatureKey,
  parseS3Uri,
} from '@/tools/s3/utils'
import type { ToolConfig } from '@/tools/types'

export const s3GetObjectTool: ToolConfig = {
  id: 's3_get_object',
  name: 'S3 Get Object',
  description: 'Retrieve an object from an AWS S3 bucket',
  version: '1.0.0',

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
      visibility: 'user-or-llm',
      description: 'S3 Object URL (e.g., https://bucket.s3.region.amazonaws.com/path/to/file)',
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
    method: 'GET',
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

        const method = 'GET'
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
    // Parse S3 URI if not already parsed
    if (!params.bucketName || !params.region || !params.objectKey) {
      const { bucketName, region, objectKey } = parseS3Uri(params.s3Uri)
      params.bucketName = bucketName
      params.region = region
      params.objectKey = objectKey
    }

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(
        `Failed to download S3 object: ${response.status} ${response.statusText} ${errorText}`
      )
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream'
    const lastModified = response.headers.get('last-modified') || new Date().toISOString()
    const fileName = params.objectKey.split('/').pop() || params.objectKey
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Generate pre-signed URL for download
    const url = generatePresignedUrl(params, 3600)

    return {
      success: true,
      output: {
        url,
        file: {
          name: fileName,
          mimeType: contentType,
          data: buffer.toString('base64'),
          size: buffer.length,
        },
        metadata: {
          fileType: contentType,
          size: buffer.length,
          name: fileName,
          lastModified: lastModified,
        },
      },
    }
  },

  outputs: {
    url: {
      type: 'string',
      description: 'Pre-signed URL for downloading the S3 object',
    },
    file: {
      type: 'file',
      description: 'Downloaded file stored in execution files',
    },
    metadata: {
      type: 'object',
      description: 'File metadata including type, size, name, and last modified date',
    },
  },
}
