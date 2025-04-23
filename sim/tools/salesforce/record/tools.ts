import { createLogger } from '@/lib/logs/console-logger'
import { RecordOperationResult, SalesforceError, SalesforceRecord, recordOperationSchema } from '../types'

const logger = createLogger('SalesforceRecordTools')

/**
 * Create records in Salesforce
 */
export async function createRecords(
  accessToken: string,
  instanceUrl: string,
  objectName: string,
  records: Record<string, any>[] | string
): Promise<RecordOperationResult[]> {
  try {
    // Parse records if they're a string
    let parsedRecords: Record<string, any>[];
    if (typeof records === 'string') {
      try {
        parsedRecords = JSON.parse(records);
      } catch (e) {
        throw new SalesforceError('Invalid JSON in records', 400, e);
      }
    } else {
      parsedRecords = records;
    }

    // Ensure records is an array
    if (!Array.isArray(parsedRecords)) {
      throw new SalesforceError('Records must be an array', 400);
    }

    // Validate input
    recordOperationSchema.parse({ objectName, records: parsedRecords });

    const response = await fetch(
      `${instanceUrl}/services/data/v59.0/composite/sobjects/${objectName}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ records: parsedRecords }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new SalesforceError('Failed to create records', response.status, error);
    }

    const result = await response.json();
    return result.records.map((record: any) => ({
      id: record.id,
      success: record.success,
      errors: record.errors || [],
    }));
  } catch (error) {
    logger.error('Error creating records:', error);
    throw new SalesforceError('Failed to create records', undefined, error);
  }
}

/**
 * Update records in Salesforce
 */
export async function updateRecords(
  accessToken: string,
  instanceUrl: string,
  objectName: string,
  records: SalesforceRecord[]
): Promise<RecordOperationResult[]> {
  try {
    // Validate input
    recordOperationSchema.parse({ objectName, records })

    const results: RecordOperationResult[] = []

    // Salesforce requires individual updates
    for (const record of records) {
      if (!record.Id) {
        results.push({
          success: false,
          errors: ['Record ID is required for update'],
        })
        continue
      }

      const response = await fetch(
        `${instanceUrl}/services/data/v59.0/sobjects/${objectName}/${record.Id}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(record),
        }
      )

      if (!response.ok) {
        const error = await response.json()
        results.push({
          id: record.Id,
          success: false,
          errors: [error.message || 'Update failed'],
        })
      } else {
        results.push({
          id: record.Id,
          success: true,
          errors: [],
        })
      }
    }

    return results
  } catch (error) {
    logger.error('Error updating records:', error)
    throw new SalesforceError('Failed to update records', undefined, error)
  }
}

/**
 * Delete records in Salesforce
 */
export async function deleteRecords(
  accessToken: string,
  instanceUrl: string,
  objectName: string,
  recordIds: string[]
): Promise<RecordOperationResult[]> {
  try {
    const results: RecordOperationResult[] = []

    // Salesforce requires individual deletes
    for (const id of recordIds) {
      const response = await fetch(
        `${instanceUrl}/services/data/v59.0/sobjects/${objectName}/${id}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      )

      if (!response.ok) {
        const error = await response.json()
        results.push({
          id,
          success: false,
          errors: [error.message || 'Delete failed'],
        })
      } else {
        results.push({
          id,
          success: true,
          errors: [],
        })
      }
    }

    return results
  } catch (error) {
    logger.error('Error deleting records:', error)
    throw new SalesforceError('Failed to delete records', undefined, error)
  }
}

/**
 * Get record by ID from Salesforce
 */
export async function getRecordById(
  accessToken: string,
  instanceUrl: string,
  objectName: string,
  recordId: string
): Promise<SalesforceRecord> {
  try {
    const response = await fetch(
      `${instanceUrl}/services/data/v59.0/sobjects/${objectName}/${recordId}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!response.ok) {
      const error = await response.json()
      throw new SalesforceError('Failed to get record', response.status, error)
    }

    return await response.json()
  } catch (error) {
    logger.error('Error getting record:', error)
    throw new SalesforceError('Failed to get record', undefined, error)
  }
} 