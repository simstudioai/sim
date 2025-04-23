import { createLogger } from '@/lib/logs/console-logger'
import { SOQLError, SOQLQueryOptions, SalesforceResponse, soqlQuerySchema } from '../types'

const logger = createLogger('SalesforceQueryTools')

/**
 * Execute a SOQL query against Salesforce
 */
export async function executeSOQLQuery(
  accessToken: string,
  instanceUrl: string,
  options: SOQLQueryOptions
): Promise<SalesforceResponse> {
  try {
    // Validate query options
    const validatedOptions = soqlQuerySchema.parse(options)

    // Encode the SOQL query
    const encodedQuery = encodeURIComponent(validatedOptions.query)
    
    // Make the API request
    const response = await fetch(
      `${instanceUrl}/services/data/v59.0/query?q=${encodedQuery}`,
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
      throw new SOQLError('SOQL query failed', error)
    }

    const data = await response.json()
    return data as SalesforceResponse
  } catch (error) {
    logger.error('Error executing SOQL query:', error)
    if (error instanceof SOQLError) {
      throw error
    }
    throw new SOQLError('Failed to execute SOQL query', error)
  }
}

/**
 * Execute a SOQL query that may return more records than the initial batch
 */
export async function executeSOQLQueryWithMoreRecords(
  accessToken: string,
  instanceUrl: string,
  options: SOQLQueryOptions
): Promise<SalesforceResponse> {
  try {
    let allRecords: any[] = []
    let response = await executeSOQLQuery(accessToken, instanceUrl, options)
    
    allRecords = allRecords.concat(response.records)

    // Keep fetching if there are more records
    while (!response.done) {
      const nextRecordsUrl = response.nextRecordsUrl
      
      const moreResponse = await fetch(
        `${instanceUrl}${nextRecordsUrl}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      )

      if (!moreResponse.ok) {
        const error = await moreResponse.json()
        throw new SOQLError('Failed to fetch additional records', error)
      }

      response = await moreResponse.json()
      allRecords = allRecords.concat(response.records)
    }

    return {
      done: true,
      totalSize: allRecords.length,
      records: allRecords,
    }
  } catch (error) {
    logger.error('Error executing SOQL query with pagination:', error)
    if (error instanceof SOQLError) {
      throw error
    }
    throw new SOQLError('Failed to execute paginated SOQL query', error)
  }
} 