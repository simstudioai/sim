import crypto from 'crypto';

interface AWSSignatureParams {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucketName: string;
  method: string;
  key: string;
  content?: Buffer;
  contentType?: string;
}

/**
 * Generate AWS signature for S3 operations
 */
export function generateAWSSignature({
  accessKeyId,
  secretAccessKey,
  region,
  bucketName,
  method,
  key,
  content,
  contentType = 'application/octet-stream'
}: AWSSignatureParams) {
  console.log('Generating AWS Signature with params:', {
    accessKeyId: accessKeyId ? 'present' : 'missing',
    secretAccessKey: secretAccessKey ? 'present' : 'missing',
    region,
    bucketName,
    method,
    key,
    contentType
  });

  const date = new Date();
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.substring(0, 8);
  
  const canonicalUri = `/${key}`;
  const canonicalQueryString = '';
  
  let payloadHash = 'UNSIGNED-PAYLOAD';
  if (content) {
    payloadHash = crypto.createHash('sha256').update(content).digest('hex');
  }
  
  let canonicalHeaders = 
    `content-type:${contentType}\n` +
    `host:${bucketName}.s3.${region}.amazonaws.com\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  
  let signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');
  
  console.log('Canonical Request:', canonicalRequest);
  
  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex')
  ].join('\n');
  
  console.log('String to Sign:', stringToSign);
  
  // Calculate the signature
  const kDate = crypto.createHmac('sha256', `AWS4${secretAccessKey}`).update(dateStamp).digest();
  const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
  const kService = crypto.createHmac('sha256', kRegion).update('s3').digest();
  const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  
  // Create the authorization header
  const authorizationHeader = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  
  const headers = {
    'Authorization': authorizationHeader,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    'Content-Type': contentType,
    'Content-Length': content ? content.length.toString() : '0'
  };
  
  console.log('Generated Headers:', headers);
  
  return {
    headers,
    contentBuffer: content
  };
}

/**
 * Get the S3 URL for a bucket and key
 */
export function getS3Url(bucketName: string, region: string, key: string): string {
  console.log('getS3Url parameters:', { bucketName, region, key });
  const url = `https://${bucketName}.s3.${region}.amazonaws.com/${encodeURIComponent(key).replace(/%2F/g, '/')}`;
  console.log('Constructed S3 URL:', url);
  return url;
}

/**
 * Parse S3 error response
 */
export function parseS3Error(errorText: string): string {
  try {
    // Check if we're in a browser environment
    if (typeof DOMParser !== 'undefined') {
      // Browser environment
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(errorText, 'text/xml');
      const codeElement = xmlDoc.getElementsByTagName('Code')[0];
      const messageElement = xmlDoc.getElementsByTagName('Message')[0];
      
      if (codeElement && messageElement) {
        return `${codeElement.textContent}: ${messageElement.textContent}`;
      }
    } else {
      // Node.js environment - simplified parsing
      const codeMatch = errorText.match(/<Code>(.*?)<\/Code>/);
      const messageMatch = errorText.match(/<Message>(.*?)<\/Message>/);
      
      if (codeMatch && messageMatch) {
        return `${codeMatch[1]}: ${messageMatch[1]}`;
      }
    }
  } catch (e) {
    // If parsing fails, return the raw error text
    return errorText.substring(0, 100); // Limit length
  }
  
  return 'Unknown S3 error';
}