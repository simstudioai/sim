import { readFile } from 'fs/promises';
import mammoth from 'mammoth';
import { FileParseResult, FileParser } from './types';

// Define interface for mammoth result
interface MammothResult {
  value: string;
  messages: any[];
}

export class DocxParser implements FileParser {
  async parseFile(filePath: string): Promise<FileParseResult> {
    try {
      // Validate input
      if (!filePath) {
        throw new Error('No file path provided');
      }
      
      // Read the file
      const buffer = await readFile(filePath);
      
      // Extract text with mammoth
      const result = await mammoth.extractRawText({ buffer });
      
      // Extract HTML for metadata (optional - won't fail if this fails)
      let htmlResult: MammothResult = { value: '', messages: [] };
      try {
        htmlResult = await mammoth.convertToHtml({ buffer });
      } catch (htmlError) {
        console.warn('HTML conversion warning:', htmlError);
      }
      
      return {
        content: result.value,
        metadata: {
          messages: [...result.messages, ...htmlResult.messages],
          html: htmlResult.value
        }
      };
    } catch (error) {
      console.error('DOCX Parser error:', error);
      throw new Error(`Failed to parse DOCX file: ${(error as Error).message}`);
    }
  }
} 