import { ToolConfig } from '../types'
import crypto from 'crypto'
import * as path from 'path'
import JSZip from 'jszip'

// Configure size limits (in bytes)
const PREVIEW_LIMITS = {
  TEXT: 100 * 1024 * 1024,      // 100MB for text files
  OFFICE: 100 * 1024 * 1024,   // 100MB for Office documents
  PDF: 100 * 1024 * 1024,      // 100MB for PDF files
  IMAGE: 100 * 1024 * 1024,     // 100MB for images
  DEFAULT: 100 * 1024 * 1024    // 100MB for other files
};

// Function to encode S3 path components
function encodeS3PathComponent(pathComponent: string): string {
  // Encode the component but preserve the path structure
  return encodeURIComponent(pathComponent).replace(/%2F/g, '/');
}

// Function to generate a pre-signed URL
function generatePresignedUrl(params: any, expiresIn: number = 3600): string {
  const date = new Date();
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const encodedPath = encodeS3PathComponent(params.objectKey);
  
  // Set expiration time
  const expires = Math.floor(Date.now() / 1000) + expiresIn;
  
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
  function getSignatureKey(key: string, dateStamp: string, regionName: string, serviceName: string): Buffer {
    const kDate = crypto.createHmac('sha256', 'AWS4' + key).update(dateStamp).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(regionName).digest();
    const kService = crypto.createHmac('sha256', kRegion).update(serviceName).digest();
    const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
    return kSigning;
  }
  
  const signingKey = getSignatureKey(params.secretAccessKey, dateStamp, params.region, 's3');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  
  // Create signed URL
  return `https://${params.bucketName}.s3.${params.region}.amazonaws.com/${encodedPath}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

// Extract content from Office XML documents
async function extractOfficeXMLText(buf: Buffer): Promise<string> {
  try {
    // Load the file as a ZIP archive
    const zip = new JSZip();
    const zipContents = await zip.loadAsync(buf);
    
    // Array to store all text content
    const textContents: string[] = [];
    
    // Look for main content files based on Office format
    const contentFiles = [
      'word/document.xml',    // Word
      'xl/sharedStrings.xml', // Excel
      'ppt/slides/*.xml'      // PowerPoint
    ];
    
    // Extract text from each relevant file
    for (const fileName of Object.keys(zipContents.files)) {
      if (contentFiles.some(pattern => {
        if (pattern.includes('*')) {
          const regex = new RegExp(pattern.replace('*', '.*'));
          return regex.test(fileName);
        }
        return fileName === pattern;
      })) {
        const content = await zipContents.files[fileName].async('text');
        // Extract text between XML tags
        const textMatches = content.match(/>([^<]+)</g) || [];
        const extractedText = textMatches
          .map(match => match.slice(1, -1)) // Remove > and <
          .filter(text => text.trim().length > 0) // Remove empty strings
          .join(' ');
        textContents.push(extractedText);
      }
    }
    
    // Combine all extracted text
    return textContents
      .join(' ')
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  } catch (e) {
    console.error('Error extracting Office document text:', e);
    return '';
  }
}

// Function to check if content is likely binary
function isBinaryContent(buf: Buffer): boolean {
  // Check the first chunk of bytes for binary content
  const sampleSize = Math.min(100, buf.length);
  for (let i = 0; i < sampleSize; i++) {
    const byte = buf[i];
    // Consider it binary if we find null bytes or too many non-printable characters
    if (byte === 0 || (byte < 32 && ![9, 10, 13].includes(byte))) {
      return true;
    }
  }
  return false;
}

// Get full content based on file type
async function getFullContent(buffer: Buffer, contentType: string, fileName: string): Promise<string> {
  const extension = path.extname(fileName).toLowerCase();
  
  // Handle Office documents
  if (['.docx', '.xlsx', '.pptx'].includes(extension)) {
    const extractedText = await extractOfficeXMLText(buffer);
    if (extractedText) {
      return extractedText;
    }
    return `[Binary content: Office document ${fileName}]`;
  }
  
  // Handle text files
  if (!isBinaryContent(buffer) || 
      contentType.includes('text/') || 
      contentType.includes('application/json') ||
      contentType.includes('application/xml') ||
      contentType.includes('application/javascript') ||
      contentType.includes('csv') ||
      extension === '.csv') {
    try {
      return buffer.toString('utf8').replace(/[^\x20-\x7E\n\r\t]/g, '');
    } catch (e) {
      return buffer.toString('ascii').replace(/[^\x20-\x7E\n\r\t]/g, '');
    }
  }
  
  // For binary files, return appropriate message
  if (contentType.includes('pdf') || extension === '.pdf') {
    return `[Binary content: PDF document ${fileName}]`;
  } else if (contentType.includes('image/')) {
    // For images, return base64 data URL
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  } else if (['.doc', '.xls', '.ppt'].includes(extension)) {
    return `[Binary content: Legacy Office document ${fileName}]`;
  }
  
  return `[Binary content: File ${fileName}]`;
}

// Get Object Tool
export const s3GetObjectTool: ToolConfig = {
  id: 's3_get_object',
  name: 'S3 Get Object',
  description: 'Retrieve an object from an AWS S3 bucket with full content access',
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
    includeFullContent: {
      type: 'boolean',
      required: false,
      default: true,
      description: 'Whether to include full file content in response'
    }
  },
  request: {
    url: (params) => {
      const encodedPath = encodeS3PathComponent(params.objectKey);
      return `https://${params.bucketName}.s3.${params.region}.amazonaws.com/${encodedPath}`;
    },
    method: 'GET',
    headers: (params) => {
      // AWS v4 Signature process
      const date = new Date()
      const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '')
      const dateStamp = amzDate.slice(0, 8)
      
      // Create the canonical request
      const method = 'GET'
      const encodedPath = encodeS3PathComponent(params.objectKey);
      const canonicalUri = `/${encodedPath}`
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
        throw new Error(`S3 request failed: ${response.status} ${response.statusText}`);
      }

      // Get file metadata
      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
      const lastModified = response.headers.get('last-modified') || new Date().toISOString();
      const fileName = params.objectKey.split('/').pop() || params.objectKey;
      const extension = path.extname(fileName).toLowerCase();

      // Generate pre-signed URL for download
      const url = generatePresignedUrl(params, 3600);

      // Read full file content
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      // Get file content based on file type
      let content = '';
      if (contentType.includes('image/')) {
        content = buffer.toString('base64');
      } else {
        content = await getFullContent(buffer, contentType, fileName);
      }

      // Create response structure
      const responseData = {
        success: true,
        output: {
          content: content,
          url: url,
          metadata: {
            fileType: contentType,
            size: contentLength,
            name: fileName,
            lastModified: lastModified
          }
        }
      };

      return responseData;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        output: {
          content: `Error: ${errorMessage}`,
          url: '',
          metadata: {
            fileType: 'error',
            size: 0,
            name: params.objectKey.split('/').pop() || params.objectKey,
            error: errorMessage
          }
        }
      };
    }
  }
}