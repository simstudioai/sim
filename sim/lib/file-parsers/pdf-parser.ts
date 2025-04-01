import { readFile } from 'fs/promises';
// @ts-ignore
import * as pdfParseLib from 'pdf-parse/lib/pdf-parse.js';
import { FileParseResult, FileParser } from './types';

export class PdfParser implements FileParser {
  async parseFile(filePath: string): Promise<FileParseResult> {
    try {
      console.log('PDF Parser: Starting to parse file:', filePath);
      
      // Make sure we're only parsing the provided file path
      if (!filePath) {
        throw new Error('No file path provided');
      }
      
      // Read the file
      console.log('PDF Parser: Reading file...');
      const dataBuffer = await readFile(filePath);
      console.log('PDF Parser: File read successfully, size:', dataBuffer.length);
      
      // Try to parse with pdf-parse library first
      try {
        console.log('PDF Parser: Attempting to parse with pdf-parse library...');
        
        // Parse PDF with direct function call to avoid test file access
        console.log('PDF Parser: Starting PDF parsing...');
        const data = await pdfParseLib.default(dataBuffer);
        console.log('PDF Parser: PDF parsed successfully with pdf-parse, pages:', data.numpages);
        
        return {
          content: data.text,
          metadata: {
            pageCount: data.numpages,
            info: data.info,
            version: data.version
          }
        };
      } catch (pdfParseError) {
        console.error('PDF-parse library failed:', pdfParseError);
        
        // Fallback to manual text extraction
        console.log('PDF Parser: Falling back to manual text extraction...');
        
        // Extract basic PDF info from raw content
        const rawContent = dataBuffer.toString('utf-8', 0, Math.min(10000, dataBuffer.length));
        
        let version = 'Unknown';
        let pageCount = 0;
        
        // Try to extract PDF version
        const versionMatch = rawContent.match(/%PDF-(\d+\.\d+)/);
        if (versionMatch && versionMatch[1]) {
          version = versionMatch[1];
        }
        
        // Try to get page count
        const pageMatches = rawContent.match(/\/Type\s*\/Page\b/g);
        if (pageMatches) {
          pageCount = pageMatches.length;
        }
        
        // Try to extract text by looking for text-related operators in the PDF
        let extractedText = '';
        
        // Look for text in the PDF content using common patterns
        const textMatches = rawContent.match(/BT[\s\S]*?ET/g);
        if (textMatches && textMatches.length > 0) {
          extractedText = textMatches.map(textBlock => {
            // Extract text objects (Tj, TJ) from the text block
            const textObjects = textBlock.match(/\([^)]*\)\s*Tj|\[[^\]]*\]\s*TJ/g);
            if (textObjects) {
              return textObjects.map(obj => {
                // Clean up text objects
                return obj.replace(/\(([^)]*)\)\s*Tj|\[([^\]]*)\]\s*TJ/g, 
                  (match, p1, p2) => p1 || p2 || '')
                  // Clean up PDF escape sequences
                  .replace(/\\(\d{3}|[()\\])/g, '')
                  .replace(/\\\\/g, '\\')
                  .replace(/\\\(/g, '(')
                  .replace(/\\\)/g, ')');
              }).join(' ');
            }
            return '';
          }).join('\n');
        }
        
        // If we couldn't extract text, provide a helpful message
        if (!extractedText || extractedText.length < 20) {
          extractedText = `This PDF document (version ${version}) contains ${pageCount || 'an unknown number of'} pages. The text could not be extracted properly.

For better results, please use a dedicated PDF reader or text extraction tool.`;
        }
        
        console.log('PDF Parser: Manual text extraction completed, found text length:', extractedText.length);
        
        return {
          content: extractedText,
          metadata: {
            pageCount: pageCount || 0,
            info: {
              manualExtraction: true,
              version
            },
            version
          }
        };
      }
    } catch (error) {
      console.error('PDF Parser error:', error);
      throw new Error(`Failed to parse PDF file: ${(error as Error).message}`);
    }
  }
} 