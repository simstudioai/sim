import { MistralParserOutput } from '@/tools/mistral/parser'
import { BlockConfig } from '../types'
import { MistralIcon } from '@/components/icons'

export const MistralParseBlock: BlockConfig<MistralParserOutput> = {
  type: 'mistral_parse',
  name: 'Mistral Parser',
  description: 'Extract text from PDF documents',
  longDescription:
    'Extract text and structure from PDF documents using Mistral\'s OCR API. Enter a URL to a PDF document (.pdf extension required), configure processing options, and get the content in your preferred format. The URL must be publicly accessible and point to a valid PDF file. Note: Google Drive, Dropbox, and other cloud storage links are not supported; use a direct download URL from a web server instead.',
  category: 'tools',
  bgColor: '#000000',
  icon: MistralIcon,
  subBlocks: [
    {
      id: 'filePath',
      title: 'PDF Document URL',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter full URL to a PDF document (https://example.com/document.pdf)',
    },
    {
      id: 'resultType',
      title: 'Output Format',
      type: 'dropdown',
      layout: 'full',
      options: [
        { id: 'markdown', label: 'Markdown (Formatted)' },
        { id: 'text', label: 'Plain Text' },
        { id: 'json', label: 'JSON (Raw)' }
      ],
    },
    {
      id: 'pages',
      title: 'Specific Pages',
      type: 'short-input',
      layout: 'full',
      placeholder: 'e.g. 0,1,2 (leave empty for all pages)',
    },
    /* 
     * Image-related parameters - temporarily disabled
     * Uncomment if PDF image extraction is needed
     *
    {
      id: 'includeImageBase64',
      title: 'Include PDF Images',
      type: 'switch',
      layout: 'half',
    },
    {
      id: 'imageLimit',
      title: 'Max Images',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Maximum number of images to extract',
    },
    {
      id: 'imageMinSize',
      title: 'Min Image Size (px)',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Min width/height in pixels',
    },
    */
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your Mistral API key',
      password: true,
    },
  ],
  tools: {
    access: ['mistral_parser'],
    config: {
      tool: () => 'mistral_parser',
      params: (params) => {
        // Basic validation
        if (!params || !params.apiKey || params.apiKey.trim() === '') {
          throw new Error('Mistral API key is required');
        }
        
        if (!params || !params.filePath || params.filePath.trim() === '') {
          throw new Error('PDF Document URL is required');
        }
        
        // Validate URL format
        let validatedUrl;
        try {
          // Try to create a URL object to validate format
          validatedUrl = new URL(params.filePath.trim());
          
          // Ensure URL is using HTTP or HTTPS protocol
          if (!['http:', 'https:'].includes(validatedUrl.protocol)) {
            throw new Error(`URL must use HTTP or HTTPS protocol. Found: ${validatedUrl.protocol}`);
          }
          
          // Check for PDF extension and provide specific guidance
          const pathname = validatedUrl.pathname.toLowerCase();
          if (!pathname.endsWith('.pdf')) {
            if (!pathname.includes('pdf')) {
              throw new Error(
                'The URL does not appear to point to a PDF document. ' +
                'Please provide a URL that ends with .pdf extension. ' +
                'If your document is not a PDF, please convert it to PDF format first.'
              );
            } else {
              // PDF is in the name but not at the end, so give a warning but proceed
              console.warn(
                'Warning: URL contains "pdf" but does not end with .pdf extension. ' +
                'This might still work if the server returns a valid PDF document.'
              );
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          throw new Error(`Invalid URL format: ${errorMessage}`);
        }
        
        // Process pages input (convert from comma-separated string to array of numbers)
        let pagesArray: number[] | undefined = undefined;
        if (params.pages && params.pages.trim() !== '') {
          try {
            pagesArray = params.pages
              .split(',')
              .map((p: string) => p.trim())
              .filter((p: string) => p.length > 0)
              .map((p: string) => {
                const num = parseInt(p, 10);
                if (isNaN(num) || num < 0) {
                  throw new Error(`Invalid page number: ${p}`);
                }
                return num;
              });
            
            if (pagesArray && pagesArray.length === 0) {
              pagesArray = undefined;
            }
          } catch (error: any) {
            throw new Error(`Page number format error: ${error.message}`);
          }
        }
        
        // Process numeric inputs
        let imageLimit: number | undefined = undefined;
        if (params.imageLimit && params.imageLimit.trim() !== '') {
          const limit = parseInt(params.imageLimit, 10);
          if (!isNaN(limit) && limit > 0) {
            imageLimit = limit;
          } else {
            throw new Error('Image limit must be a positive number');
          }
        }
        
        let imageMinSize: number | undefined = undefined;
        if (params.imageMinSize && params.imageMinSize.trim() !== '') {
          const size = parseInt(params.imageMinSize, 10);
          if (!isNaN(size) && size > 0) {
            imageMinSize = size;
          } else {
            throw new Error('Minimum image size must be a positive number');
          }
        }
        
        // Return structured parameters for the tool
        const parameters: any = {
          filePath: validatedUrl.toString(),
          apiKey: params.apiKey.trim(),
          resultType: params.resultType || 'markdown',
        };
        
        // Add optional parameters if they're defined
        if (pagesArray && pagesArray.length > 0) {
          parameters.pages = pagesArray;
        }
        
        /* 
         * Image-related parameters - temporarily disabled
         * Uncomment if PDF image extraction is needed
         *
        if (typeof params.includeImageBase64 === 'boolean') {
          parameters.includeImageBase64 = params.includeImageBase64;
        }
        
        if (imageLimit !== undefined) {
          parameters.imageLimit = imageLimit;
        }
        
        if (imageMinSize !== undefined) {
          parameters.imageMinSize = imageMinSize;
        }
        */
        
        return parameters;
      },
    },
  },
  inputs: {
    filePath: { type: 'string', required: true },
    apiKey: { type: 'string', required: true },
    resultType: { type: 'string', required: false },
    pages: { type: 'string', required: false },
    // Image-related inputs - temporarily disabled
    // includeImageBase64: { type: 'boolean', required: false },
    // imageLimit: { type: 'string', required: false },
    // imageMinSize: { type: 'string', required: false },
  },
  outputs: {
    response: {
      type: {
        content: 'string',
        metadata: 'json',
      },
    },
  },
} 