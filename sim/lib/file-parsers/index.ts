import path from 'path';
import { FileParser, SupportedFileType, FileParseResult } from './types';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { RawPdfParser } from './raw-pdf-parser';

// Lazy-loaded parsers to avoid initialization issues
let parserInstances: Record<string, FileParser> | null = null;

/**
 * Get parser instances with lazy initialization
 */
function getParserInstances(): Record<string, FileParser> {
  if (parserInstances === null) {
    parserInstances = {};
    
    try {
      // Import parsers only when needed - with try/catch for each one
      try {
        console.log('Attempting to load PDF parser...');
        try {
          // First try to use the pdf-parse library
          // Import the PdfParser using ES module import to avoid test file access
          const { PdfParser } = require('./pdf-parser');
          parserInstances['pdf'] = new PdfParser();
          console.log('PDF parser loaded successfully');
        } catch (pdfParseError) {
          // If that fails, fallback to our raw PDF parser
          console.error('Failed to load primary PDF parser:', pdfParseError);
          console.log('Falling back to raw PDF parser');
          parserInstances['pdf'] = new RawPdfParser();
          console.log('Raw PDF parser loaded successfully');
        }
      } catch (error) {
        console.error('Failed to load any PDF parser:', error);
        // Create a simple fallback that just returns the file size and a message
        parserInstances['pdf'] = {
          async parseFile(filePath: string): Promise<FileParseResult> {
            const buffer = await readFile(filePath);
            return {
              content: `PDF parsing is not available. File size: ${buffer.length} bytes`,
              metadata: {
                info: { Error: 'PDF parsing unavailable' },
                pageCount: 0,
                version: 'unknown'
              }
            };
          }
        };
      }
      
      try {
        const { CsvParser } = require('./csv-parser');
        parserInstances['csv'] = new CsvParser();
      } catch (error) {
        console.error('Failed to load CSV parser:', error);
      }
      
      try {
        const { DocxParser } = require('./docx-parser');
        parserInstances['docx'] = new DocxParser();
      } catch (error) {
        console.error('Failed to load DOCX parser:', error);
      }
    } catch (error) {
      console.error('Error loading file parsers:', error);
    }
  }
  
  console.log('Available parsers:', Object.keys(parserInstances));
  return parserInstances;
}

/**
 * Parse a file based on its extension
 * @param filePath Path to the file
 * @returns Parsed content and metadata
 */
export async function parseFile(filePath: string): Promise<FileParseResult> {
  try {
    // Validate input
    if (!filePath) {
      throw new Error('No file path provided');
    }
    
    // Check if file exists
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    
    const extension = path.extname(filePath).toLowerCase().substring(1);
    console.log('Attempting to parse file with extension:', extension);
    
    const parsers = getParserInstances();
    
    if (!Object.keys(parsers).includes(extension)) {
      console.log('No parser found for extension:', extension);
      throw new Error(`Unsupported file type: ${extension}. Supported types are: ${Object.keys(parsers).join(', ')}`);
    }
    
    console.log('Using parser for extension:', extension);
    const parser = parsers[extension];
    return await parser.parseFile(filePath);
  } catch (error) {
    console.error('File parsing error:', error);
    throw error;
  }
}

/**
 * Check if a file type is supported
 * @param extension File extension without the dot
 * @returns true if supported, false otherwise
 */
export function isSupportedFileType(extension: string): extension is SupportedFileType {
  try {
    return Object.keys(getParserInstances()).includes(extension.toLowerCase());
  } catch (error) {
    console.error('Error checking supported file type:', error);
    return false;
  }
}

// Type exports
export type { FileParseResult, FileParser, SupportedFileType }; 