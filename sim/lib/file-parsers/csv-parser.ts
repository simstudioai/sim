import { createReadStream, existsSync } from 'fs';
import { FileParseResult, FileParser } from './types';
import csvParser from 'csv-parser';

export class CsvParser implements FileParser {
  async parseFile(filePath: string): Promise<FileParseResult> {
    return new Promise((resolve, reject) => {
      try {
        // Validate input
        if (!filePath) {
          return reject(new Error('No file path provided'));
        }
        
        // Check if file exists
        if (!existsSync(filePath)) {
          return reject(new Error(`File not found: ${filePath}`));
        }
        
        const results: Record<string, any>[] = [];
        const headers: string[] = [];

        createReadStream(filePath)
          .on('error', (error: Error) => {
            console.error('CSV stream error:', error);
            reject(new Error(`Failed to read CSV file: ${error.message}`));
          })
          .pipe(csvParser())
          .on('headers', (headerList: string[]) => {
            headers.push(...headerList);
          })
          .on('data', (data: Record<string, any>) => {
            results.push(data);
          })
          .on('end', () => {
            // Convert CSV data to a formatted string representation
            let content = '';
            
            // Add headers
            if (headers.length > 0) {
              content += headers.join(', ') + '\n';
            }
            
            // Add rows
            results.forEach(row => {
              const rowValues = Object.values(row).join(', ');
              content += rowValues + '\n';
            });
            
            resolve({
              content,
              metadata: {
                rowCount: results.length,
                headers: headers,
                rawData: results
              }
            });
          })
          .on('error', (error: Error) => {
            console.error('CSV parsing error:', error);
            reject(new Error(`Failed to parse CSV file: ${error.message}`));
          });
      } catch (error) {
        console.error('CSV general error:', error);
        reject(new Error(`Failed to process CSV file: ${(error as Error).message}`));
      }
    });
  }
} 