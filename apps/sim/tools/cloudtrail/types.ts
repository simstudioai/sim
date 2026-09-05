import type { ToolResponse } from '@/tools/types'

interface CloudTrailConnectionConfig {
  awsRegion: string
  awsAccessKeyId: string
  awsSecretAccessKey: string
}

export interface CloudTrailAdvancedEventSelector {
  name: string | null
  fieldSelectors: {
    field: string
    equals: string[]
    startsWith: string[]
    endsWith: string[]
    notEquals: string[]
    notStartsWith: string[]
    notEndsWith: string[]
  }[]
}

export interface CloudTrailTrail {
  name: string
  s3BucketName: string | null
  s3KeyPrefix: string | null
  snsTopicName: string | null
  snsTopicArn: string | null
  includeGlobalServiceEvents: boolean | null
  isMultiRegionTrail: boolean | null
  homeRegion: string | null
  trailArn: string | null
  logFileValidationEnabled: boolean | null
  cloudWatchLogsLogGroupArn: string | null
  cloudWatchLogsRoleArn: string | null
  kmsKeyId: string | null
  hasCustomEventSelectors: boolean | null
  hasInsightSelectors: boolean | null
  isOrganizationTrail: boolean | null
}

export type CloudTrailLookupAttributeKey =
  | 'AccessKeyId'
  | 'EventId'
  | 'EventName'
  | 'EventSource'
  | 'ReadOnly'
  | 'ResourceName'
  | 'ResourceType'
  | 'Username'

export interface CloudTrailLookupEventsParams extends CloudTrailConnectionConfig {
  attributeKey?: CloudTrailLookupAttributeKey
  attributeValue?: string
  startTime?: string
  endTime?: string
  eventCategory?: 'insight'
  maxResults?: number
  nextToken?: string
}

export interface CloudTrailEvent {
  eventId: string | null
  eventName: string | null
  readOnly: string | null
  accessKeyId: string | null
  eventTime: string | null
  eventSource: string | null
  username: string | null
  resources: { resourceType: string | null; resourceName: string | null }[]
  cloudTrailEvent: Record<string, unknown> | null
  cloudTrailEventRaw: string | null
}

export interface CloudTrailLookupEventsResponse extends ToolResponse {
  output: {
    events: CloudTrailEvent[]
    nextToken: string | null
  }
}

export interface CloudTrailDescribeTrailsParams extends CloudTrailConnectionConfig {
  trailNameList?: string
  includeShadowTrails?: boolean
}

export interface CloudTrailDescribeTrailsResponse extends ToolResponse {
  output: {
    trails: CloudTrailTrail[]
  }
}

export interface CloudTrailGetTrailParams extends CloudTrailConnectionConfig {
  name: string
}

export interface CloudTrailGetTrailResponse extends ToolResponse {
  output: CloudTrailTrail
}

export interface CloudTrailGetTrailStatusParams extends CloudTrailConnectionConfig {
  name: string
}

export interface CloudTrailGetTrailStatusResponse extends ToolResponse {
  output: {
    isLogging: boolean | null
    latestDeliveryError: string | null
    latestDeliveryTime: string | null
    latestNotificationError: string | null
    latestNotificationTime: string | null
    latestCloudWatchLogsDeliveryError: string | null
    latestCloudWatchLogsDeliveryTime: string | null
    latestDigestDeliveryError: string | null
    latestDigestDeliveryTime: string | null
    startLoggingTime: string | null
    stopLoggingTime: string | null
  }
}

export interface CloudTrailListTrailsParams extends CloudTrailConnectionConfig {
  nextToken?: string
}

export interface CloudTrailListTrailsResponse extends ToolResponse {
  output: {
    trails: { trailArn: string | null; name: string | null; homeRegion: string | null }[]
    nextToken: string | null
  }
}

export interface CloudTrailGetEventSelectorsParams extends CloudTrailConnectionConfig {
  trailName: string
}

export interface CloudTrailGetEventSelectorsResponse extends ToolResponse {
  output: {
    trailArn: string | null
    eventSelectors: {
      readWriteType: string | null
      includeManagementEvents: boolean | null
      dataResources: { type: string | null; values: string[] }[]
      excludeManagementEventSources: string[]
    }[]
    advancedEventSelectors: CloudTrailAdvancedEventSelector[]
  }
}

export interface CloudTrailGetInsightSelectorsParams extends CloudTrailConnectionConfig {
  trailName?: string
  eventDataStore?: string
}

export interface CloudTrailGetInsightSelectorsResponse extends ToolResponse {
  output: {
    trailArn: string | null
    eventDataStoreArn: string | null
    insightsDestination: string | null
    insightSelectors: { insightType: string | null; eventCategories: string[] }[]
  }
}

export interface CloudTrailStartQueryParams extends CloudTrailConnectionConfig {
  queryStatement?: string
  queryAlias?: string
  queryParameters?: string
  deliveryS3Uri?: string
  eventDataStoreOwnerAccountId?: string
}

export interface CloudTrailStartQueryResponse extends ToolResponse {
  output: {
    queryId: string
    eventDataStoreOwnerAccountId: string | null
  }
}

export interface CloudTrailDescribeQueryParams extends CloudTrailConnectionConfig {
  queryId?: string
  queryAlias?: string
  refreshId?: string
  eventDataStoreOwnerAccountId?: string
}

export interface CloudTrailDescribeQueryResponse extends ToolResponse {
  output: {
    queryId: string | null
    queryString: string | null
    queryStatus: string | null
    errorMessage: string | null
    deliveryS3Uri: string | null
    deliveryStatus: string | null
    prompt: string | null
    eventDataStoreOwnerAccountId: string | null
    eventsMatched: number | null
    eventsScanned: number | null
    bytesScanned: number | null
    executionTimeInMillis: number | null
    creationTime: string | null
  }
}

export interface CloudTrailGetQueryResultsParams extends CloudTrailConnectionConfig {
  queryId: string
  maxQueryResults?: number
  nextToken?: string
  eventDataStoreOwnerAccountId?: string
}

export interface CloudTrailGetQueryResultsResponse extends ToolResponse {
  output: {
    queryStatus: string | null
    rows: Record<string, string>[]
    resultsCount: number | null
    totalResultsCount: number | null
    bytesScanned: number | null
    errorMessage: string | null
    nextToken: string | null
  }
}

export interface CloudTrailCancelQueryParams extends CloudTrailConnectionConfig {
  queryId: string
  eventDataStoreOwnerAccountId?: string
}

export interface CloudTrailCancelQueryResponse extends ToolResponse {
  output: {
    queryId: string
    queryStatus: string | null
    eventDataStoreOwnerAccountId: string | null
  }
}

export interface CloudTrailEventDataStoreSummary {
  eventDataStoreArn: string | null
  name: string | null
  status: string | null
  advancedEventSelectors: CloudTrailAdvancedEventSelector[]
  multiRegionEnabled: boolean | null
  organizationEnabled: boolean | null
  retentionPeriod: number | null
  terminationProtectionEnabled: boolean | null
  createdTimestamp: string | null
  updatedTimestamp: string | null
}

export interface CloudTrailListEventDataStoresParams extends CloudTrailConnectionConfig {
  maxResults?: number
  nextToken?: string
}

export interface CloudTrailListEventDataStoresResponse extends ToolResponse {
  output: {
    eventDataStores: CloudTrailEventDataStoreSummary[]
    nextToken: string | null
  }
}

export interface CloudTrailGetEventDataStoreParams extends CloudTrailConnectionConfig {
  eventDataStore: string
}

export interface CloudTrailGetEventDataStoreResponse extends ToolResponse {
  output: CloudTrailEventDataStoreSummary & {
    kmsKeyId: string | null
    billingMode: string | null
    federationStatus: string | null
    federationRoleArn: string | null
    partitionKeys: { name: string; type: string }[]
  }
}

export interface CloudTrailListTagsParams extends CloudTrailConnectionConfig {
  resourceIdList: string
  nextToken?: string
}

export interface CloudTrailListTagsResponse extends ToolResponse {
  output: {
    resourceTags: {
      resourceId: string | null
      tags: { key: string; value: string | null }[]
    }[]
    nextToken: string | null
  }
}
