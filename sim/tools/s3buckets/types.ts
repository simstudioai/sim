export interface S3Response {
  success: boolean;
  output: {
    // Upload operation response
    etag?: string;
    location?: string;
    
    // Get operation response
    content?: string;
    contentType?: string;
    
    // Error response
    error?: string;
  };
} 