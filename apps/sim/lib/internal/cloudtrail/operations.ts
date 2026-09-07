import {
  type AdvancedEventSelector,
  CancelQueryCommand,
  type CloudTrailClient,
  DescribeQueryCommand,
  DescribeTrailsCommand,
  GetEventDataStoreCommand,
  GetEventSelectorsCommand,
  GetInsightSelectorsCommand,
  GetQueryResultsCommand,
  GetTrailCommand,
  GetTrailStatusCommand,
  ListEventDataStoresCommand,
  ListTagsCommand,
  ListTrailsCommand,
  LookupEventsCommand,
  StartQueryCommand,
  type Trail,
} from '@aws-sdk/client-cloudtrail'
import { createLogger } from '@sim/logger'
import type { AwsCloudtrailCancelQueryBody } from '@/lib/api/contracts/tools/aws/cloudtrail-cancel-query'
import type { AwsCloudtrailDescribeQueryBody } from '@/lib/api/contracts/tools/aws/cloudtrail-describe-query'
import type { AwsCloudtrailDescribeTrailsBody } from '@/lib/api/contracts/tools/aws/cloudtrail-describe-trails'
import type { AwsCloudtrailGetEventDataStoreBody } from '@/lib/api/contracts/tools/aws/cloudtrail-get-event-data-store'
import type { AwsCloudtrailGetEventSelectorsBody } from '@/lib/api/contracts/tools/aws/cloudtrail-get-event-selectors'
import type { AwsCloudtrailGetInsightSelectorsBody } from '@/lib/api/contracts/tools/aws/cloudtrail-get-insight-selectors'
import type { AwsCloudtrailGetQueryResultsBody } from '@/lib/api/contracts/tools/aws/cloudtrail-get-query-results'
import type { AwsCloudtrailGetTrailBody } from '@/lib/api/contracts/tools/aws/cloudtrail-get-trail'
import type { AwsCloudtrailGetTrailStatusBody } from '@/lib/api/contracts/tools/aws/cloudtrail-get-trail-status'
import type { AwsCloudtrailListEventDataStoresBody } from '@/lib/api/contracts/tools/aws/cloudtrail-list-event-data-stores'
import type { AwsCloudtrailListTagsBody } from '@/lib/api/contracts/tools/aws/cloudtrail-list-tags'
import type { AwsCloudtrailListTrailsBody } from '@/lib/api/contracts/tools/aws/cloudtrail-list-trails'
import type { AwsCloudtrailLookupEventsBody } from '@/lib/api/contracts/tools/aws/cloudtrail-lookup-events'
import type { AwsCloudtrailStartQueryBody } from '@/lib/api/contracts/tools/aws/cloudtrail-start-query'
import {
  type CloudTrailConnectionConfig,
  type CreateCloudTrailClientOptions,
  createCloudTrailClient,
} from '@/lib/internal/cloudtrail/client'

const logger = createLogger('CloudTrailOperations')

async function withCloudTrailClient<T>(
  input: CloudTrailConnectionConfig,
  execute: (client: CloudTrailClient) => Promise<T>,
  options?: CreateCloudTrailClientOptions
): Promise<T> {
  const client = createCloudTrailClient(input, options)
  try {
    return await execute(client)
  } finally {
    client.destroy()
  }
}

function mapAdvancedEventSelectors(selectors: AdvancedEventSelector[] | undefined) {
  return (selectors ?? []).map((selector) => ({
    name: selector.Name ?? null,
    fieldSelectors: (selector.FieldSelectors ?? []).map((field) => ({
      field: field.Field ?? '',
      equals: field.Equals ?? [],
      startsWith: field.StartsWith ?? [],
      endsWith: field.EndsWith ?? [],
      notEquals: field.NotEquals ?? [],
      notStartsWith: field.NotStartsWith ?? [],
      notEndsWith: field.NotEndsWith ?? [],
    })),
  }))
}

function mapTrail(trail: Trail | undefined) {
  return {
    name: trail?.Name ?? '',
    s3BucketName: trail?.S3BucketName ?? null,
    s3KeyPrefix: trail?.S3KeyPrefix ?? null,
    snsTopicName: trail?.SnsTopicName ?? null,
    snsTopicArn: trail?.SnsTopicARN ?? null,
    includeGlobalServiceEvents: trail?.IncludeGlobalServiceEvents ?? null,
    isMultiRegionTrail: trail?.IsMultiRegionTrail ?? null,
    homeRegion: trail?.HomeRegion ?? null,
    trailArn: trail?.TrailARN ?? null,
    logFileValidationEnabled: trail?.LogFileValidationEnabled ?? null,
    cloudWatchLogsLogGroupArn: trail?.CloudWatchLogsLogGroupArn ?? null,
    cloudWatchLogsRoleArn: trail?.CloudWatchLogsRoleArn ?? null,
    kmsKeyId: trail?.KmsKeyId ?? null,
    hasCustomEventSelectors: trail?.HasCustomEventSelectors ?? null,
    hasInsightSelectors: trail?.HasInsightSelectors ?? null,
    isOrganizationTrail: trail?.IsOrganizationTrail ?? null,
  }
}

/**
 * `LookupEvents` returns the full event record as a JSON-encoded string in
 * `CloudTrailEvent`. Downstream agents want the structured record (userIdentity,
 * sourceIPAddress, requestParameters, errorCode), so it is parsed into
 * `cloudTrailEvent`. If parsing ever fails the original string is preserved in
 * `cloudTrailEventRaw` so no data is lost.
 */
function parseCloudTrailEvent(raw: string | undefined): {
  cloudTrailEvent: Record<string, unknown> | null
  cloudTrailEventRaw: string | null
} {
  if (!raw) return { cloudTrailEvent: null, cloudTrailEventRaw: null }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { cloudTrailEvent: parsed as Record<string, unknown>, cloudTrailEventRaw: null }
    }
  } catch {
    logger.warn('Failed to parse CloudTrailEvent payload; returning the raw string')
    return { cloudTrailEvent: null, cloudTrailEventRaw: raw }
  }
  return { cloudTrailEvent: null, cloudTrailEventRaw: raw }
}

export async function executeCloudtrailLookupEvents(
  input: AwsCloudtrailLookupEventsBody,
  signal?: AbortSignal
) {
  return withCloudTrailClient(
    input,
    async (client) => {
      const response = await client.send(
        new LookupEventsCommand({
          ...(input.attributeKey && input.attributeValue
            ? {
                LookupAttributes: [
                  { AttributeKey: input.attributeKey, AttributeValue: input.attributeValue },
                ],
              }
            : {}),
          ...(input.startTime ? { StartTime: new Date(input.startTime) } : {}),
          ...(input.endTime ? { EndTime: new Date(input.endTime) } : {}),
          ...(input.eventCategory ? { EventCategory: input.eventCategory } : {}),
          ...(input.maxResults !== undefined ? { MaxResults: input.maxResults } : {}),
          ...(input.nextToken ? { NextToken: input.nextToken } : {}),
        }),
        { abortSignal: signal }
      )
      return {
        success: true,
        output: {
          events: (response.Events ?? []).map((event) => ({
            eventId: event.EventId ?? null,
            eventName: event.EventName ?? null,
            readOnly: event.ReadOnly ?? null,
            accessKeyId: event.AccessKeyId ?? null,
            eventTime: event.EventTime?.toISOString() ?? null,
            eventSource: event.EventSource ?? null,
            username: event.Username ?? null,
            resources: (event.Resources ?? []).map((resource) => ({
              resourceType: resource.ResourceType ?? null,
              resourceName: resource.ResourceName ?? null,
            })),
            ...parseCloudTrailEvent(event.CloudTrailEvent),
          })),
          nextToken: response.NextToken ?? null,
        },
      }
    },
    { throttleSensitive: true }
  )
}

export async function executeCloudtrailDescribeTrails(
  input: AwsCloudtrailDescribeTrailsBody,
  signal?: AbortSignal
) {
  return withCloudTrailClient(input, async (client) => {
    const response = await client.send(
      new DescribeTrailsCommand({
        ...(input.trailNameList ? { trailNameList: input.trailNameList } : {}),
        ...(input.includeShadowTrails !== undefined
          ? { includeShadowTrails: input.includeShadowTrails }
          : {}),
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: { trails: (response.trailList ?? []).map(mapTrail) },
    }
  })
}

export async function executeCloudtrailGetTrail(
  input: AwsCloudtrailGetTrailBody,
  signal?: AbortSignal
) {
  return withCloudTrailClient(input, async (client) => {
    const response = await client.send(new GetTrailCommand({ Name: input.name }), {
      abortSignal: signal,
    })
    if (!response.Trail) throw new Error('No trail data returned')
    return { success: true, output: mapTrail(response.Trail) }
  })
}

export async function executeCloudtrailGetTrailStatus(
  input: AwsCloudtrailGetTrailStatusBody,
  signal?: AbortSignal
) {
  return withCloudTrailClient(input, async (client) => {
    const response = await client.send(new GetTrailStatusCommand({ Name: input.name }), {
      abortSignal: signal,
    })
    return {
      success: true,
      output: {
        isLogging: response.IsLogging ?? null,
        latestDeliveryError: response.LatestDeliveryError ?? null,
        latestDeliveryTime: response.LatestDeliveryTime?.toISOString() ?? null,
        latestNotificationError: response.LatestNotificationError ?? null,
        latestNotificationTime: response.LatestNotificationTime?.toISOString() ?? null,
        latestCloudWatchLogsDeliveryError: response.LatestCloudWatchLogsDeliveryError ?? null,
        latestCloudWatchLogsDeliveryTime:
          response.LatestCloudWatchLogsDeliveryTime?.toISOString() ?? null,
        latestDigestDeliveryError: response.LatestDigestDeliveryError ?? null,
        latestDigestDeliveryTime: response.LatestDigestDeliveryTime?.toISOString() ?? null,
        startLoggingTime: response.StartLoggingTime?.toISOString() ?? null,
        stopLoggingTime: response.StopLoggingTime?.toISOString() ?? null,
      },
    }
  })
}

export async function executeCloudtrailListTrails(
  input: AwsCloudtrailListTrailsBody,
  signal?: AbortSignal
) {
  return withCloudTrailClient(input, async (client) => {
    const response = await client.send(
      new ListTrailsCommand({ ...(input.nextToken ? { NextToken: input.nextToken } : {}) }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        trails: (response.Trails ?? []).map((trail) => ({
          trailArn: trail.TrailARN ?? null,
          name: trail.Name ?? null,
          homeRegion: trail.HomeRegion ?? null,
        })),
        nextToken: response.NextToken ?? null,
      },
    }
  })
}

export async function executeCloudtrailGetEventSelectors(
  input: AwsCloudtrailGetEventSelectorsBody,
  signal?: AbortSignal
) {
  return withCloudTrailClient(input, async (client) => {
    const response = await client.send(
      new GetEventSelectorsCommand({ TrailName: input.trailName }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        trailArn: response.TrailARN ?? null,
        eventSelectors: (response.EventSelectors ?? []).map((selector) => ({
          readWriteType: selector.ReadWriteType ?? null,
          includeManagementEvents: selector.IncludeManagementEvents ?? null,
          dataResources: (selector.DataResources ?? []).map((resource) => ({
            type: resource.Type ?? null,
            values: resource.Values ?? [],
          })),
          excludeManagementEventSources: selector.ExcludeManagementEventSources ?? [],
        })),
        advancedEventSelectors: mapAdvancedEventSelectors(response.AdvancedEventSelectors),
      },
    }
  })
}

export async function executeCloudtrailGetInsightSelectors(
  input: AwsCloudtrailGetInsightSelectorsBody,
  signal?: AbortSignal
) {
  return withCloudTrailClient(input, async (client) => {
    const response = await client.send(
      new GetInsightSelectorsCommand({
        ...(input.trailName ? { TrailName: input.trailName } : {}),
        ...(input.eventDataStore ? { EventDataStore: input.eventDataStore } : {}),
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        trailArn: response.TrailARN ?? null,
        eventDataStoreArn: response.EventDataStoreArn ?? null,
        insightsDestination: response.InsightsDestination ?? null,
        insightSelectors: (response.InsightSelectors ?? []).map((selector) => ({
          insightType: selector.InsightType ?? null,
          eventCategories: selector.EventCategories ?? [],
        })),
      },
    }
  })
}

export async function executeCloudtrailStartQuery(
  input: AwsCloudtrailStartQueryBody,
  signal?: AbortSignal
) {
  return withCloudTrailClient(input, async (client) => {
    const response = await client.send(
      new StartQueryCommand({
        ...(input.queryStatement ? { QueryStatement: input.queryStatement } : {}),
        ...(input.queryAlias ? { QueryAlias: input.queryAlias } : {}),
        ...(input.queryParameters ? { QueryParameters: input.queryParameters } : {}),
        ...(input.deliveryS3Uri ? { DeliveryS3Uri: input.deliveryS3Uri } : {}),
        ...(input.eventDataStoreOwnerAccountId
          ? { EventDataStoreOwnerAccountId: input.eventDataStoreOwnerAccountId }
          : {}),
      }),
      { abortSignal: signal }
    )
    if (!response.QueryId) throw new Error('No query ID returned')
    return {
      success: true,
      output: {
        queryId: response.QueryId,
        eventDataStoreOwnerAccountId: response.EventDataStoreOwnerAccountId ?? null,
      },
    }
  })
}

export async function executeCloudtrailDescribeQuery(
  input: AwsCloudtrailDescribeQueryBody,
  signal?: AbortSignal
) {
  return withCloudTrailClient(input, async (client) => {
    const response = await client.send(
      new DescribeQueryCommand({
        ...(input.queryId ? { QueryId: input.queryId } : {}),
        ...(input.queryAlias ? { QueryAlias: input.queryAlias } : {}),
        ...(input.refreshId ? { RefreshId: input.refreshId } : {}),
        ...(input.eventDataStoreOwnerAccountId
          ? { EventDataStoreOwnerAccountId: input.eventDataStoreOwnerAccountId }
          : {}),
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        queryId: response.QueryId ?? null,
        queryString: response.QueryString ?? null,
        queryStatus: response.QueryStatus ?? null,
        errorMessage: response.ErrorMessage ?? null,
        deliveryS3Uri: response.DeliveryS3Uri ?? null,
        deliveryStatus: response.DeliveryStatus ?? null,
        prompt: response.Prompt ?? null,
        eventDataStoreOwnerAccountId: response.EventDataStoreOwnerAccountId ?? null,
        eventsMatched: response.QueryStatistics?.EventsMatched ?? null,
        eventsScanned: response.QueryStatistics?.EventsScanned ?? null,
        bytesScanned: response.QueryStatistics?.BytesScanned ?? null,
        executionTimeInMillis: response.QueryStatistics?.ExecutionTimeInMillis ?? null,
        creationTime: response.QueryStatistics?.CreationTime?.toISOString() ?? null,
      },
    }
  })
}

export async function executeCloudtrailGetQueryResults(
  input: AwsCloudtrailGetQueryResultsBody,
  signal?: AbortSignal
) {
  return withCloudTrailClient(input, async (client) => {
    const response = await client.send(
      new GetQueryResultsCommand({
        QueryId: input.queryId,
        ...(input.maxQueryResults !== undefined ? { MaxQueryResults: input.maxQueryResults } : {}),
        ...(input.nextToken ? { NextToken: input.nextToken } : {}),
        ...(input.eventDataStoreOwnerAccountId
          ? { EventDataStoreOwnerAccountId: input.eventDataStoreOwnerAccountId }
          : {}),
      }),
      { abortSignal: signal }
    )
    const rows = (response.QueryResultRows ?? []).map((row) => {
      const record: Record<string, string> = {}
      for (const cell of row) {
        for (const [key, value] of Object.entries(cell)) {
          record[key] = value ?? ''
        }
      }
      return record
    })
    return {
      success: true,
      output: {
        queryStatus: response.QueryStatus ?? null,
        rows,
        resultsCount: response.QueryStatistics?.ResultsCount ?? null,
        totalResultsCount: response.QueryStatistics?.TotalResultsCount ?? null,
        bytesScanned: response.QueryStatistics?.BytesScanned ?? null,
        errorMessage: response.ErrorMessage ?? null,
        nextToken: response.NextToken ?? null,
      },
    }
  })
}

export async function executeCloudtrailCancelQuery(
  input: AwsCloudtrailCancelQueryBody,
  signal?: AbortSignal
) {
  return withCloudTrailClient(input, async (client) => {
    const response = await client.send(
      new CancelQueryCommand({
        QueryId: input.queryId,
        ...(input.eventDataStoreOwnerAccountId
          ? { EventDataStoreOwnerAccountId: input.eventDataStoreOwnerAccountId }
          : {}),
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        queryId: response.QueryId ?? input.queryId,
        queryStatus: response.QueryStatus ?? null,
        eventDataStoreOwnerAccountId: response.EventDataStoreOwnerAccountId ?? null,
      },
    }
  })
}

export async function executeCloudtrailListEventDataStores(
  input: AwsCloudtrailListEventDataStoresBody,
  signal?: AbortSignal
) {
  return withCloudTrailClient(input, async (client) => {
    const response = await client.send(
      new ListEventDataStoresCommand({
        ...(input.maxResults !== undefined ? { MaxResults: input.maxResults } : {}),
        ...(input.nextToken ? { NextToken: input.nextToken } : {}),
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        eventDataStores: (response.EventDataStores ?? []).map((store) => ({
          eventDataStoreArn: store.EventDataStoreArn ?? null,
          name: store.Name ?? null,
          status: store.Status ?? null,
          advancedEventSelectors: mapAdvancedEventSelectors(store.AdvancedEventSelectors),
          multiRegionEnabled: store.MultiRegionEnabled ?? null,
          organizationEnabled: store.OrganizationEnabled ?? null,
          retentionPeriod: store.RetentionPeriod ?? null,
          terminationProtectionEnabled: store.TerminationProtectionEnabled ?? null,
          createdTimestamp: store.CreatedTimestamp?.toISOString() ?? null,
          updatedTimestamp: store.UpdatedTimestamp?.toISOString() ?? null,
        })),
        nextToken: response.NextToken ?? null,
      },
    }
  })
}

export async function executeCloudtrailGetEventDataStore(
  input: AwsCloudtrailGetEventDataStoreBody,
  signal?: AbortSignal
) {
  return withCloudTrailClient(input, async (client) => {
    const response = await client.send(
      new GetEventDataStoreCommand({ EventDataStore: input.eventDataStore }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        eventDataStoreArn: response.EventDataStoreArn ?? null,
        name: response.Name ?? null,
        status: response.Status ?? null,
        advancedEventSelectors: mapAdvancedEventSelectors(response.AdvancedEventSelectors),
        multiRegionEnabled: response.MultiRegionEnabled ?? null,
        organizationEnabled: response.OrganizationEnabled ?? null,
        retentionPeriod: response.RetentionPeriod ?? null,
        terminationProtectionEnabled: response.TerminationProtectionEnabled ?? null,
        createdTimestamp: response.CreatedTimestamp?.toISOString() ?? null,
        updatedTimestamp: response.UpdatedTimestamp?.toISOString() ?? null,
        kmsKeyId: response.KmsKeyId ?? null,
        billingMode: response.BillingMode ?? null,
        federationStatus: response.FederationStatus ?? null,
        federationRoleArn: response.FederationRoleArn ?? null,
        partitionKeys: (response.PartitionKeys ?? []).map((key) => ({
          name: key.Name ?? '',
          type: key.Type ?? '',
        })),
      },
    }
  })
}

export async function executeCloudtrailListTags(
  input: AwsCloudtrailListTagsBody,
  signal?: AbortSignal
) {
  return withCloudTrailClient(input, async (client) => {
    const response = await client.send(
      new ListTagsCommand({
        ResourceIdList: input.resourceIdList,
        ...(input.nextToken ? { NextToken: input.nextToken } : {}),
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        resourceTags: (response.ResourceTagList ?? []).map((resourceTag) => ({
          resourceId: resourceTag.ResourceId ?? null,
          tags: (resourceTag.TagsList ?? []).map((tag) => ({
            key: tag.Key ?? '',
            value: tag.Value ?? null,
          })),
        })),
        nextToken: response.NextToken ?? null,
      },
    }
  })
}
