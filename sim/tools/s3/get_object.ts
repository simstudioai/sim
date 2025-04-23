import { ToolConfig } from '../types'
import crypto from 'crypto'

// Function to encode S3 path components
function encodeS3PathComponent(pathComponent: string): string {
  if (!pathComponent) return '';
  // Encode the component but preserve the path structure
  return encodeURIComponent(pathComponent).replace(/%2F/g, '/');
}

// Function to generate AWS signature key
function getSignatureKey(key: string, dateStamp: string, regionName: string, serviceName: string): Buffer {
  if (!key || typeof key !== 'string') {
    throw new Error(`Invalid key provided to getSignatureKey: ${typeof key}`);
  }
  
  if (!dateStamp || typeof dateStamp !== 'string') {
    throw new Error(`Invalid dateStamp provided to getSignatureKey: ${typeof dateStamp}`);
  }
  
  if (!regionName || typeof regionName !== 'string') {
    throw new Error(`Invalid regionName provided to getSignatureKey: ${typeof regionName}`);
  }
  
  if (!serviceName || typeof serviceName !== 'string') {
    throw new Error(`Invalid serviceName provided to getSignatureKey: ${typeof serviceName}`);
  }
  
  try {
    const kDate = crypto.createHmac('sha256', 'AWS4' + key).update(dateStamp).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(regionName).digest();
    const kService = crypto.createHmac('sha256', kRegion).update(serviceName).digest();
    const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
    return kSigning;
  } catch (error) {
    console.error('Error in getSignatureKey:', error);
    throw error;
  }
}

// Function to generate a pre-signed URL
function generatePresignedUrl(params: any, expiresIn: number = 3600): string {
  if (!params.accessKeyId || !params.secretAccessKey || !params.region || !params.bucketName || !params.objectKey) {
    console.error('Missing required params for presigned URL', {
      hasAccessKeyId: !!params.accessKeyId,
      hasSecretAccessKey: !!params.secretAccessKey,
      region: params.region,
      bucketName: params.bucketName,
      objectKey: params.objectKey
    });
    throw new Error('Missing required parameters for presigned URL generation');
  }

  console.log('Generating presigned URL for:', {
    bucket: params.bucketName,
    region: params.region,
    objectKey: params.objectKey
  });

  try {
    const date = new Date();
    const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const encodedPath = encodeS3PathComponent(params.objectKey);
    
    // Create the canonical request
    const method = 'GET';
    const canonicalUri = `/${encodedPath}`;
    const canonicalQueryString = `X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=${encodeURIComponent(params.accessKeyId + '/' + dateStamp + '/' + params.region + '/s3/aws4_request')}&X-Amz-Date=${amzDate}&X-Amz-Expires=${expiresIn}&X-Amz-SignedHeaders=host`;
    const canonicalHeaders = 'host:' + params.bucketName + '.s3.' + params.region + '.amazonaws.com\n';
    const signedHeaders = 'host';
    const payloadHash = 'UNSIGNED-PAYLOAD';
    
    const canonicalRequest = method + '\n' + 
                           canonicalUri + '\n' + 
                           canonicalQueryString + '\n' + 
                           canonicalHeaders + '\n' + 
                           signedHeaders + '\n' + 
                           payloadHash;
    
    // Create string to sign
    const algorithm = 'AWS4-HMAC-SHA256';
    const credentialScope = dateStamp + '/' + params.region + '/s3/aws4_request';
    const stringToSign = algorithm + '\n' + 
                        amzDate + '\n' + 
                        credentialScope + '\n' + 
                        crypto.createHash('sha256').update(canonicalRequest).digest('hex');
    
    // Calculate signature
    const signingKey = getSignatureKey(params.secretAccessKey, dateStamp, params.region, 's3');
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
    
    // Create signed URL
    const signedUrl = `https://${params.bucketName}.s3.${params.region}.amazonaws.com/${encodedPath}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
    
    console.log('Generated presigned URL (first 100 chars):', signedUrl.substring(0, 100) + '...');
    return signedUrl;
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    throw error;
  }
}

// Function to test AWS credentials and S3 access
async function testS3Access(params: {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucketName: string;
  objectKey: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    console.log('Testing S3 access with params:', {
      bucketName: params.bucketName,
      region: params.region,
      objectKey: params.objectKey,
      hasAccessKeyId: !!params.accessKeyId,
      hasSecretKey: !!params.secretAccessKey
    });

    // Generate a test URL
    const testUrl = `https://${params.bucketName}.s3.${params.region}.amazonaws.com/${params.objectKey}`;
    console.log('Testing URL:', testUrl);

    // Generate headers for the test request
    const date = new Date();
    const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = crypto.createHash('sha256').update('').digest('hex');
    
    const canonicalHeaders = 
      'host:' + params.bucketName + '.s3.' + params.region + '.amazonaws.com\n' +
      'x-amz-content-sha256:' + payloadHash + '\n' +
      'x-amz-date:' + amzDate + '\n';
    
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest = 'HEAD\n' + 
                           `/${encodeS3PathComponent(params.objectKey)}\n` + 
                           '\n' + 
                           canonicalHeaders + '\n' + 
                           signedHeaders + '\n' + 
                           payloadHash;
    
    const algorithm = 'AWS4-HMAC-SHA256';
    const credentialScope = dateStamp + '/' + params.region + '/s3/aws4_request';
    const stringToSign = algorithm + '\n' + 
                        amzDate + '\n' + 
                        credentialScope + '\n' + 
                        crypto.createHash('sha256').update(canonicalRequest).digest('hex');
    
    const signingKey = getSignatureKey(params.secretAccessKey, dateStamp, params.region, 's3');
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
    
    const authorizationHeader = algorithm + ' ' +
      'Credential=' + params.accessKeyId + '/' + credentialScope + ', ' +
      'SignedHeaders=' + signedHeaders + ', ' +
      'Signature=' + signature;

    // Make the test request
    const response = await fetch(testUrl, {
      method: 'HEAD',
      headers: {
        'Host': `${params.bucketName}.s3.${params.region}.amazonaws.com`,
        'X-Amz-Content-Sha256': payloadHash,
        'X-Amz-Date': amzDate,
        'Authorization': authorizationHeader
      }
    });

    if (!response.ok) {
      const errorText = await response.text().catch(e => 'Could not read error text');
      console.error('S3 test request failed:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText
      });
      return {
        success: false,
        error: `S3 test request failed: ${response.status} ${response.statusText} - ${errorText}`
      };
    }

    console.log('S3 test request successful');
    return { success: true };
  } catch (error) {
    console.error('Error testing S3 access:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during S3 test'
    };
  }
}

// Get Object Tool
export const s3GetObjectTool: ToolConfig = {
  id: 's3_get_object',
  name: 'S3 Get Object',
  description: 'Generate a presigned URL for accessing an S3 object',
  version: '2.0.0',
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
    url: (params) => {
      console.log('Making HEAD request for object metadata');
      
      // Validate parameters
      if (!params.bucketName || !params.region || !params.objectKey) {
        console.error('Missing required params for HEAD request', {
          bucketName: params.bucketName,
          region: params.region, 
          objectKey: params.objectKey
        });
        throw new Error('Missing required parameters for HEAD request URL');
      }
      
      const encodedPath = encodeS3PathComponent(params.objectKey);
      return `https://${params.bucketName}.s3.${params.region}.amazonaws.com/${encodedPath}`;
    },
    method: 'HEAD', // Using HEAD request since we only need metadata
    headers: (params) => {
      try {
        console.log('Generating headers for HEAD request');
        
        // Validate required parameters
        if (!params.accessKeyId || !params.secretAccessKey || !params.region || !params.bucketName || !params.objectKey) {
          console.error('Missing required params for headers', {
            hasAccessKeyId: !!params.accessKeyId,
            hasSecretKey: !!params.secretAccessKey,
            region: params.region,
            bucketName: params.bucketName,
            objectKey: params.objectKey
          });
          throw new Error('Missing required parameters for header generation');
        }
        
        // AWS v4 Signature process
        const date = new Date();
        const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
        const dateStamp = amzDate.slice(0, 8);
        
        // Create the canonical request
        const method = 'HEAD';
        const encodedPath = encodeS3PathComponent(params.objectKey);
        const canonicalUri = `/${encodedPath}`;
        const canonicalQueryString = '';
        const payloadHash = crypto.createHash('sha256').update('').digest('hex');
        const canonicalHeaders = 
          'host:' + params.bucketName + '.s3.' + params.region + '.amazonaws.com\n' +
          'x-amz-content-sha256:' + payloadHash + '\n' +
          'x-amz-date:' + amzDate + '\n';
        const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
        const canonicalRequest = method + '\n' + 
                               canonicalUri + '\n' + 
                               canonicalQueryString + '\n' + 
                               canonicalHeaders + '\n' + 
                               signedHeaders + '\n' + 
                               payloadHash;
        
        // Create the string to sign
        const algorithm = 'AWS4-HMAC-SHA256';
        const credentialScope = dateStamp + '/' + params.region + '/s3/aws4_request';
        const stringToSign = algorithm + '\n' + 
                           amzDate + '\n' + 
                           credentialScope + '\n' + 
                           crypto.createHash('sha256').update(canonicalRequest).digest('hex');
        
        const signingKey = getSignatureKey(params.secretAccessKey, dateStamp, params.region, 's3');
        const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
        
        // Create the authorization header
        const authorizationHeader = algorithm + ' ' +
          'Credential=' + params.accessKeyId + '/' + credentialScope + ', ' +
          'SignedHeaders=' + signedHeaders + ', ' +
          'Signature=' + signature;
        
        console.log('Generated AUTH headers for HEAD request');
        
        return {
          'X-Amz-Content-Sha256': payloadHash,
          'X-Amz-Date': amzDate,
          'Authorization': authorizationHeader
        };
      } catch (error) {
        console.error('Error generating headers:', error);
        throw error;
      }
    }
  },
  transformResponse: async (response: Response, params) => {
    try {
      console.log('Received HEAD response:', response.status, response.statusText);
      
      if (!response.ok) {
        const errorText = await response.text().catch(e => 'Could not read error text');
        console.error('S3 HEAD request failed', response.status, response.statusText, errorText);
        throw new Error(`S3 request failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      // Get file metadata from headers
      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
      const lastModified = response.headers.get('last-modified') || new Date().toISOString();
      const fileName = params.objectKey.split('/').pop() || params.objectKey;

      console.log('File metadata:', {
        fileName,
        contentType,
        contentLength: `${contentLength} bytes`,
        lastModified
      });

      // Generate pre-signed URL for download (this doesn't attempt to load the file)
      const url = generatePresignedUrl(params, 3600);

      // Return only the URL and metadata
      return {
        success: true,
        output: {
          url: url,
          metadata: {
            fileName: fileName,
            contentType: contentType,
            fileSize: contentLength,
            lastModified: lastModified
          }
        }
      };
    } catch (error: unknown) {
      console.error('S3 Error in transformResponse:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        output: {
          url: '',
          metadata: {
            fileName: params.objectKey ? (params.objectKey.split('/').pop() || params.objectKey) : 'unknown',
            contentType: 'error',
            fileSize: 0,
            lastModified: new Date().toISOString(),
            error: errorMessage
          }
        }
      };
    }
  },
  test: async (params) => {
    return testS3Access({
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      region: params.region,
      bucketName: params.bucketName,
      objectKey: params.objectKey
    });
  }
}