import path from 'path';
import { FileParser, SupportedFileType, FileParseResult } from './types';
import { existsSync } from 'fs';

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
        const { PdfParser } = require('./pdf-parser');
        parserInstances['pdf'] = new PdfParser();
      } catch (error) {
        console.error('Failed to load PDF parser:', error);
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
    const parsers = getParserInstances();
    
    if (!Object.keys(parsers).includes(extension)) {
      throw new Error(`Unsupported file type: ${extension}. Supported types are: ${Object.keys(parsers).join(', ')}`);
    }
    
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