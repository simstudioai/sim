import { ToolConfig } from "../types";
import { generateAWSSignature } from './utils/aws-signature';

// S3 Download Object Tool
export const s3DownloadObjectTool: ToolConfig = {
  id: 's3buckets_download',
  name: 'Download S3 Object',
  description: 'Download an object from an Amazon S3 bucket',
  version: '1.0.0',
  params: {
    accessKeyId: {
      type: 'string',
      required: true,
      description: 'AWS Access Key ID',
    },
    secretAccessKey: {
      type: 'string',
      required: true,
      description: 'AWS Secret Access Key',
    },
    region: {
      type: 'string',
      required: true,
      default: 'us-east-1',
      description: 'AWS Region where the bucket is located',
    },
    bucketName: {
      type: 'string',
      required: true,
      description: 'Name of the S3 bucket',
    },
    key: {
      type: 'string',
      required: true,
      description: 'Object key (path in the bucket)',
    }
  },
  request: {
    url: (params) => {
      const url = `https://${params.bucketName}.s3.${params.region}.amazonaws.com/${encodeURIComponent(params.key)}`;
      console.log('S3 Download Request URL:', url);
      return url;
    },
    method: 'GET',
    headers: (params) => {
      const date = new Date();
      const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
      
      const { headers } = generateAWSSignature({
        accessKeyId: params.accessKeyId,
        secretAccessKey: params.secretAccessKey,
        region: params.region,
        bucketName: params.bucketName,
        method: 'GET',
        key: params.key,
        content: Buffer.from(''),
        contentType: 'application/octet-stream'
      });

      console.log('S3 Download Request Headers:', headers);
      return headers;
    }
  },
  transformResponse: async (response, params) => {
    try {
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`S3 Download Error: ${response.status} - ${errorText}`);
      }

      const contentType = response.headers.get('Content-Type') || 'application/octet-stream';
      const contentLength = response.headers.get('Content-Length');
      const fileName = params.key.split('/').pop() || '';

      // Check if it's a directory
      if (contentType.includes('directory') || contentLength === '0') {
        return {
          success: true,
          output: {
            url: `https://${params.bucketName}.s3.${params.region}.amazonaws.com/${params.key}`,
            success: true,
            message: "Failed to load image",
            fileContent: "",
            contentType,
            contentLength: 0
          }
        };
      }

      // Handle different content types
      if (contentType.startsWith('image/')) {
        // For images, return as base64
        const arrayBuffer = await response.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');
        return {
          success: true,
          output: {
            url: `https://${params.bucketName}.s3.${params.region}.amazonaws.com/${params.key}`,
            success: true,
            message: "Image loaded successfully",
            fileContent: base64,
            contentType,
            contentLength: arrayBuffer.byteLength
          }
        };
      } else {
        // For other files, return the filename
        return {
          success: true,
          output: {
            url: `https://${params.bucketName}.s3.${params.region}.amazonaws.com/${params.key}`,
            success: true,
            message: `File: ${fileName}`,
            fileContent: fileName,
            contentType,
            contentLength: contentLength ? parseInt(contentLength) : 0
          }
        };
      }
    } catch (error: any) {
      return {
        success: false,
        output: {
          url: `https://${params.bucketName}.s3.${params.region}.amazonaws.com/${params.key}`,
          success: false,
          message: `Failed to load image`,
          fileContent: "",
          contentType: "application/octet-stream",
          contentLength: 0
        }
      };
    }
  }
}; 