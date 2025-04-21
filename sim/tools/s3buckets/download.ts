import { ToolConfig } from '../types'
import crypto from 'crypto'
import * as path from 'path'
import JSZip from 'jszip'

// Configure size limits (in bytes)
const PREVIEW_LIMITS = {
  TEXT: 5 * 1024 * 1024,      // 5MB for text files
  OFFICE: 10 * 1024 * 1024,   // 10MB for Office documents
  IMAGE: 2 * 1024 * 1024,     // 2MB for images
  DEFAULT: 1 * 1024 * 1024    // 1MB for other files
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
    parseContent: {
      type: 'boolean',
      required: false,
      default: true,
      description: 'Whether to parse the file content based on file type',
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

      // Generate pre-signed URL first, before handling any file data
      const downloadUrl = generatePresignedUrl(params, 3600);

      // Initialize response structure
      const responseData = {
        success: true,
        output: {
          content: downloadUrl,
          preview: '',
          filePreview: '',  // New field for text preview
          fileType: '',
          metadata: {
            fileName,
            contentType,
            fileSize: contentLength,
            lastModified,
            extension,
            sizeExceedsLimit: contentLength >= 1024 * 1024
          }
        }
      };

      // Format file size for display
      const fileSizeStr = contentLength > 1024 * 1024 
        ? `${(contentLength / 1024 / 1024).toFixed(2)} MB`
        : `${(contentLength / 1024).toFixed(2)} KB`;

      // Always try to get a preview of the content
      try {
        // Read appropriate chunk of the file based on type
        let previewSizeLimit = PREVIEW_LIMITS.DEFAULT;

        // Determine appropriate size limit based on file type
        if (['.docx', '.xlsx', '.pptx'].includes(extension)) {
          previewSizeLimit = PREVIEW_LIMITS.OFFICE;
        } else if (contentType.includes('text/') || 
                  contentType.includes('application/json') ||
                  contentType.includes('application/xml') ||
                  contentType.includes('application/javascript') ||
                  contentType.includes('csv') ||
                  extension === '.csv') {
          previewSizeLimit = PREVIEW_LIMITS.TEXT;
        } else if (contentType.includes('image/')) {
          previewSizeLimit = PREVIEW_LIMITS.IMAGE;
        }

        // Read first chunk of the file
        const previewChunkSize = Math.min(previewSizeLimit, contentLength);
        const arrayBuffer = await response.clone().arrayBuffer();
        const buffer = Buffer.from(arrayBuffer.slice(0, previewChunkSize));
        
        // Function to check if content is likely binary
        const isBinaryContent = (buf: Buffer): boolean => {
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
        };

        // Function to extract text from Office XML documents
        const extractOfficeXMLText = async (buf: Buffer): Promise<string> => {
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
              .trim()
              .substring(0, 1000);
          } catch (e) {
            console.error('Error extracting Office document text:', e);
            return '';
          }
        };

        let filePreview = '';
        
        // Handle different file types
        if (['.docx', '.xlsx', '.pptx'].includes(extension)) {
          if (contentLength > PREVIEW_LIMITS.OFFICE) {
            responseData.output.filePreview = `Office document too large to preview (${(contentLength / (1024 * 1024)).toFixed(2)}MB). Size limit is ${PREVIEW_LIMITS.OFFICE / (1024 * 1024)}MB. Use the download link to view the file.`;
          } else {
            filePreview = await extractOfficeXMLText(buffer);
            if (!filePreview) {
              responseData.output.filePreview = 'Could not extract text from this Office document. Use the download link to view the file.';
            } else {
              responseData.output.filePreview = filePreview + (filePreview.length >= 1000 ? '...' : '');
            }
          }
        } else if (!isBinaryContent(buffer)) {
          if (contentLength > previewSizeLimit) {
            responseData.output.filePreview = `File too large to preview (${(contentLength / (1024 * 1024)).toFixed(2)}MB). Size limit is ${previewSizeLimit / (1024 * 1024)}MB. Use the download link to view the file.`;
          } else {
            try {
              filePreview = buffer.toString('utf8')
                .replace(/[^\x20-\x7E\n\r\t]/g, '')
                .trim()
                .substring(0, 1000);
            } catch (e) {
              filePreview = buffer.toString('ascii')
                .replace(/[^\x20-\x7E\n\r\t]/g, '')
                .trim()
                .substring(0, 1000);
            }
            
            if (filePreview.length > 0) {
              responseData.output.filePreview = filePreview + (contentLength > previewChunkSize ? '...' : '');
            }
          }
        }

        // If no preview could be generated, provide appropriate message
        if (!responseData.output.filePreview) {
          const fileSizeStr = (contentLength / (1024 * 1024)).toFixed(2);
          if (contentType.includes('pdf') || extension === '.pdf') {
            responseData.output.filePreview = `PDF document (${fileSizeStr}MB) - binary content cannot be previewed. Use the download link to view the full file.`;
          } else if (contentType.includes('image/')) {
            responseData.output.filePreview = `Image file (${fileSizeStr}MB) - binary content cannot be previewed. Use the download link to view the image.`;
          } else if (['.doc', '.xls', '.ppt'].includes(extension)) {
            responseData.output.filePreview = `Legacy Office document (${fileSizeStr}MB) - binary content cannot be previewed. Use the download link to view the file.`;
          } else {
            responseData.output.filePreview = `Binary file (${fileSizeStr}MB) - content cannot be previewed. Use the download link to access the file.`;
          }
        }
      } catch (e) {
        responseData.output.filePreview = 'Preview not available - error reading file content.';
      }

      // Handle file based on type
      if (contentType.includes('image/') && contentLength < 1024 * 1024) {
        // Only load image data if it's small enough
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        responseData.output.fileType = 'image';
        responseData.output.preview = `[Image: ${fileName}] (${fileSizeStr})`;
      } else {
        // For non-images or large images
        responseData.output.fileType = contentType.includes('image/') ? 'image' : (contentType.split('/')[0] || 'binary');
        
        // For text-based files that are small enough
        if (contentLength < 1024 * 1024 && (
            contentType.includes('text/') || 
            contentType.includes('application/json') ||
            contentType.includes('application/xml') ||
            contentType.includes('application/javascript') ||
            contentType.includes('csv') ||
            extension === '.csv')) {
          
          // Parse JSON if applicable and file is not too large
          if ((contentType.includes('application/json') || fileName.endsWith('.json'))) {
            try {
              JSON.parse(responseData.output.filePreview);
            } catch (e) {
              // Silently fail JSON parsing
              responseData.output.preview = `JSON File: ${fileName} (${fileSizeStr})`;
            }
          }
        }

        // For large files or non-text files
        let fileType = 'binary';
        let typeLabel = 'File';
        
        switch(true) {
          case contentType.includes('pdf') || extension === '.pdf':
            fileType = 'pdf';
            typeLabel = 'PDF Document';
            break;
          case contentType.includes('document') || extension === '.docx':
            fileType = 'document';
            typeLabel = 'Word Document';
            break;
          case contentType.includes('spreadsheet') || ['.xlsx', '.xls'].includes(extension):
            fileType = 'spreadsheet';
            typeLabel = 'Spreadsheet';
            break;
          case contentType.includes('presentation') || ['.ppt', '.pptx'].includes(extension):
            fileType = 'presentation';
            typeLabel = 'Presentation';
            break;
          case contentType.includes('csv') || extension === '.csv':
            fileType = 'text';
            typeLabel = 'CSV File';
            break;
          case contentType.includes('text/') || extension === '.txt':
            fileType = 'text';
            typeLabel = 'Text File';
            break;
          default:
            fileType = 'binary';
            typeLabel = 'Binary File';
        }
        
        responseData.output.fileType = fileType;
        responseData.output.preview = `${typeLabel}: ${fileName} (${fileSizeStr})`;
      }

      return responseData;
    } catch (error: unknown) {
      // Simplified error response
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        output: {
          content: '',
          preview: `Error: ${errorMessage}`,
          filePreview: '',
          fileType: '',
          metadata: {
            fileName: params.objectKey.split('/').pop() || params.objectKey,
            contentType: '',
            fileSize: 0,
            lastModified: '',
            extension: '',
            sizeExceedsLimit: false
          }
        }
      };
    }
  }
}