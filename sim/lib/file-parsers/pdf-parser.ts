import { readFile } from 'fs/promises';
// @ts-ignore
import pdfParse from 'pdf-parse';
import { FileParseResult, FileParser } from './types';

export class PdfParser implements FileParser {
  async parseFile(filePath: string): Promise<FileParseResult> {
    try {
      // Make sure we're only parsing the provided file path
      if (!filePath) {
        throw new Error('No file path provided');
      }
      
      // Read the file
      const dataBuffer = await readFile(filePath);
      
      // Parse PDF with pdf-parse
      // We're using a custom options object to prevent the library from accessing 
      // its test files which causes ENOENT errors
      const options = {
        // Override the default test file path access
        pagerender: undefined,
        max: 0
      };
      
      const data = await pdfParse(dataBuffer, options);
      
      return {
        content: data.text,
        metadata: {
          pageCount: data.numpages,
          info: data.info,
          version: data.version
        }
      };
    } catch (error) {
      console.error('PDF Parser error:', error);
      throw new Error(`Failed to parse PDF file: ${(error as Error).message}`);
    }
  }
} 