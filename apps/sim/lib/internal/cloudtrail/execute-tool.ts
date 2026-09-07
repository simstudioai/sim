import { getErrorMessage } from '@sim/utils/errors'
import type { AnyApiRouteContract, ContractBody } from '@/lib/api/contracts'
import { awsCloudtrailCancelQueryContract } from '@/lib/api/contracts/tools/aws/cloudtrail-cancel-query'
import { awsCloudtrailDescribeQueryContract } from '@/lib/api/contracts/tools/aws/cloudtrail-describe-query'
import { awsCloudtrailDescribeTrailsContract } from '@/lib/api/contracts/tools/aws/cloudtrail-describe-trails'
import { awsCloudtrailGetEventDataStoreContract } from '@/lib/api/contracts/tools/aws/cloudtrail-get-event-data-store'
import { awsCloudtrailGetEventSelectorsContract } from '@/lib/api/contracts/tools/aws/cloudtrail-get-event-selectors'
import { awsCloudtrailGetInsightSelectorsContract } from '@/lib/api/contracts/tools/aws/cloudtrail-get-insight-selectors'
import { awsCloudtrailGetQueryResultsContract } from '@/lib/api/contracts/tools/aws/cloudtrail-get-query-results'
import { awsCloudtrailGetTrailContract } from '@/lib/api/contracts/tools/aws/cloudtrail-get-trail'
import { awsCloudtrailGetTrailStatusContract } from '@/lib/api/contracts/tools/aws/cloudtrail-get-trail-status'
import { awsCloudtrailListEventDataStoresContract } from '@/lib/api/contracts/tools/aws/cloudtrail-list-event-data-stores'
import { awsCloudtrailListTagsContract } from '@/lib/api/contracts/tools/aws/cloudtrail-list-tags'
import { awsCloudtrailListTrailsContract } from '@/lib/api/contracts/tools/aws/cloudtrail-list-trails'
import { awsCloudtrailLookupEventsContract } from '@/lib/api/contracts/tools/aws/cloudtrail-lookup-events'
import { awsCloudtrailStartQueryContract } from '@/lib/api/contracts/tools/aws/cloudtrail-start-query'
import {
  executeCloudtrailCancelQuery,
  executeCloudtrailDescribeQuery,
  executeCloudtrailDescribeTrails,
  executeCloudtrailGetEventDataStore,
  executeCloudtrailGetEventSelectors,
  executeCloudtrailGetInsightSelectors,
  executeCloudtrailGetQueryResults,
  executeCloudtrailGetTrail,
  executeCloudtrailGetTrailStatus,
  executeCloudtrailListEventDataStores,
  executeCloudtrailListTags,
  executeCloudtrailListTrails,
  executeCloudtrailLookupEvents,
  executeCloudtrailStartQuery,
} from '@/lib/internal/cloudtrail/operations'
import { parseInternalToolInput } from '@/lib/internal/tool-operations/parse-input'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

async function executeOperation<C extends AnyApiRouteContract>(
  contract: C,
  input: unknown,
  execute: (input: ContractBody<C>, signal?: AbortSignal) => Promise<unknown>,
  fallbackError: string,
  signal?: AbortSignal
): Promise<Response> {
  signal?.throwIfAborted()
  const parsed = parseInternalToolInput(contract, input)
  if (!parsed.success) return parsed.response

  try {
    const result = await execute(parsed.data, signal)
    signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    signal?.throwIfAborted()
    return Response.json({ error: getErrorMessage(error, fallbackError) }, { status: 500 })
  }
}

export const executeCloudtrailTool: InternalToolOperationHandler = async ({
  toolId,
  input,
  signal,
}) => {
  signal?.throwIfAborted()
  switch (toolId) {
    case 'cloudtrail_cancel_query':
      return executeOperation(
        awsCloudtrailCancelQueryContract,
        input,
        executeCloudtrailCancelQuery,
        'Failed to cancel CloudTrail Lake query',
        signal
      )
    case 'cloudtrail_describe_query':
      return executeOperation(
        awsCloudtrailDescribeQueryContract,
        input,
        executeCloudtrailDescribeQuery,
        'Failed to describe CloudTrail Lake query',
        signal
      )
    case 'cloudtrail_describe_trails':
      return executeOperation(
        awsCloudtrailDescribeTrailsContract,
        input,
        executeCloudtrailDescribeTrails,
        'Failed to describe CloudTrail trails',
        signal
      )
    case 'cloudtrail_get_event_data_store':
      return executeOperation(
        awsCloudtrailGetEventDataStoreContract,
        input,
        executeCloudtrailGetEventDataStore,
        'Failed to get CloudTrail event data store',
        signal
      )
    case 'cloudtrail_get_event_selectors':
      return executeOperation(
        awsCloudtrailGetEventSelectorsContract,
        input,
        executeCloudtrailGetEventSelectors,
        'Failed to get CloudTrail event selectors',
        signal
      )
    case 'cloudtrail_get_insight_selectors':
      return executeOperation(
        awsCloudtrailGetInsightSelectorsContract,
        input,
        executeCloudtrailGetInsightSelectors,
        'Failed to get CloudTrail Insights selectors',
        signal
      )
    case 'cloudtrail_get_query_results':
      return executeOperation(
        awsCloudtrailGetQueryResultsContract,
        input,
        executeCloudtrailGetQueryResults,
        'Failed to get CloudTrail Lake query results',
        signal
      )
    case 'cloudtrail_get_trail':
      return executeOperation(
        awsCloudtrailGetTrailContract,
        input,
        executeCloudtrailGetTrail,
        'Failed to get CloudTrail trail',
        signal
      )
    case 'cloudtrail_get_trail_status':
      return executeOperation(
        awsCloudtrailGetTrailStatusContract,
        input,
        executeCloudtrailGetTrailStatus,
        'Failed to get CloudTrail trail status',
        signal
      )
    case 'cloudtrail_list_event_data_stores':
      return executeOperation(
        awsCloudtrailListEventDataStoresContract,
        input,
        executeCloudtrailListEventDataStores,
        'Failed to list CloudTrail event data stores',
        signal
      )
    case 'cloudtrail_list_tags':
      return executeOperation(
        awsCloudtrailListTagsContract,
        input,
        executeCloudtrailListTags,
        'Failed to list CloudTrail resource tags',
        signal
      )
    case 'cloudtrail_list_trails':
      return executeOperation(
        awsCloudtrailListTrailsContract,
        input,
        executeCloudtrailListTrails,
        'Failed to list CloudTrail trails',
        signal
      )
    case 'cloudtrail_lookup_events':
      return executeOperation(
        awsCloudtrailLookupEventsContract,
        input,
        executeCloudtrailLookupEvents,
        'Failed to look up CloudTrail events',
        signal
      )
    case 'cloudtrail_start_query':
      return executeOperation(
        awsCloudtrailStartQueryContract,
        input,
        executeCloudtrailStartQuery,
        'Failed to start CloudTrail Lake query',
        signal
      )
    default:
      return Response.json({ error: `Unsupported CloudTrail tool: ${toolId}` }, { status: 500 })
  }
}
