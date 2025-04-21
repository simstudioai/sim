import { ToolConfig } from '../types'
import crypto from 'crypto'
import fetch from 'node-fetch'

// Get Object Tool
export const s3GetObjectTool: ToolConfig = {
  id: 's3_get_object',
  name: 'S3 Get Object',
  description: 'Retrieve an object from an AWS S3 bucket',
  version: '1.0.0',
  params: {
    accessKeyId: {
      type: 'string',
      required: true,
      description: 'Your AWS Access Key ID',
    },
    secretAccessKey: {
      type: 'string',
      required: true,
      description: 'Your AWS Secret Access Key',
    },
    region: {
      type: 'string',
      required: true,
      description: 'AWS region where the bucket is located',
    },
    bucketName: {
      type: 'string',
      required: true,
      description: 'Name of the S3 bucket',
    },
    objectKey: {
      type: 'string',
      required: true,
      description: 'Key (path) of the object to retrieve',
    },
  },
  request: {
    url: (params) => `https://${params.bucketName}.s3.${params.region}.amazonaws.com/${params.objectKey}`,
    method: 'GET',
    headers: (params) => {
      // AWS v4 Signature process
      const date = new Date()
      const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '')
      const dateStamp = amzDate.slice(0, 8)
      
      // Create the canonical request
      const method = 'GET'
      const canonicalUri = `/${params.objectKey}`
      const canonicalQueryString = ''
      const payloadHash = crypto.createHash('sha256').update('').digest('hex') // Empty payload for GET
      const canonicalHeaders = 
        'host:' + params.bucketName + '.s3.' + params.region + '.amazonaws.com' + '\n' +
        'x-amz-content-sha256:' + payloadHash + '\n' +
        'x-amz-date:' + amzDate + '\n'
      const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
      const canonicalRequest = method + '\n' + canonicalUri + '\n' + canonicalQueryString + '\n' + 
                              canonicalHeaders + '\n' + signedHeaders + '\n' + payloadHash
      
      // Create the string to sign
      const algorithm = 'AWS4-HMAC-SHA256'
      const credentialScope = dateStamp + '/' + params.region + '/s3/aws4_request'
      const stringToSign = algorithm + '\n' + amzDate + '\n' + credentialScope + '\n' + 
                          crypto.createHash('sha256').update(canonicalRequest).digest('hex')
      
      // Calculate the signature
      function getSignatureKey(key: string, dateStamp: string, regionName: string, serviceName: string): Buffer {
        const kDate = crypto.createHmac('sha256', 'AWS4' + key).update(dateStamp).digest()
        const kRegion = crypto.createHmac('sha256', kDate).update(regionName).digest()
        const kService = crypto.createHmac('sha256', kRegion).update(serviceName).digest()
        const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest()
        return kSigning
      }
      
      const signingKey = getSignatureKey(params.secretAccessKey, dateStamp, params.region, 's3')
      const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')
      
      // Create the authorization header
      const authorizationHeader = algorithm + ' ' +
        'Credential=' + params.accessKeyId + '/' + credentialScope + ', ' +
        'SignedHeaders=' + signedHeaders + ', ' +
        'Signature=' + signature
      
      return {
        'X-Amz-Content-Sha256': payloadHash,
        'X-Amz-Date': amzDate,
        'Authorization': authorizationHeader
      }
    }
  },
  transformResponse: async (response: Response, params) => {
    try {
      if (!response.ok) {
        throw new Error(`S3 request failed: ${response.status} ${response.statusText}`)
      }
      
      // Get file metadata
      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
      const lastModified = response.headers.get('last-modified') || new Date().toISOString();
      const fileName = params.objectKey.split('/').pop() || params.objectKey;
      
      // Get the file data
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const base64Data = buffer.toString('base64');
      
      // Determine file type based on contentType or file extension
      const fileExtension = fileName.split('.').pop()?.toLowerCase();
      
      // Process content based on file type
      let content = '';
      let fileType = ''; // Add a fileType field to help with rendering
      
      // For text-based files
      if (contentType.includes('text/') || 
          contentType.includes('application/json') ||
          contentType.includes('application/xml') ||
          contentType.includes('application/javascript')) {
        content = buffer.toString('utf-8');
        fileType = 'text';
      } 
      // For PDFs
      else if (contentType.includes('application/pdf') || fileExtension === 'pdf') {
        content = `https://${params.bucketName}.s3.${params.region}.amazonaws.com/${params.objectKey}`;
        fileType = 'pdf';
      }
      // For images
      else if (contentType.includes('image/') || 
              ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'].includes(fileExtension)) {
        content = `https://${params.bucketName}.s3.${params.region}.amazonaws.com/${params.objectKey}`;
        fileType = 'image';
      }
      // For documents like docx, xlsx, etc.
      else if (contentType.includes('application/vnd.openxmlformats') || 
              ['docx', 'xlsx', 'pptx'].includes(fileExtension)) {
        content = `https://${params.bucketName}.s3.${params.region}.amazonaws.com/${params.objectKey}`;
        fileType = 'document';
      }
      // For any other file type
      else {
        content = `https://${params.bucketName}.s3.${params.region}.amazonaws.com/${params.objectKey}`;
        fileType = 'binary';
      }
      
      // Return a consistent response structure for all file types
      return {
        success: true,
        output: {
          content: content,
          data: base64Data,
          fileType: fileType, // Add this to help with rendering
          metadata: {
            fileName: fileName,
            contentType: contentType,
            fileSize: contentLength,
            lastModified: lastModified
          }
        }
      };
    } catch (error: unknown) {
      console.error('S3 Get Object error:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      return {
        success: false,
        output: {
          content: '',
          data: '',
          metadata: {
            fileName: params.objectKey.split('/').pop() || params.objectKey,
            contentType: '',
            fileSize: 0,
            lastModified: ''
          },
          error: errorMessage
        }
      }
    }
  }
}