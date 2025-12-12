// Common types for PostHog tools
import type { ToolResponse } from '@/tools/types'

// Common base parameters
export interface PostHogBaseParams {
  region?: 'us' | 'eu'
}

export interface PostHogPublicParams extends PostHogBaseParams {
  projectApiKey: string
}

export interface PostHogPrivateParams extends PostHogBaseParams {
  personalApiKey: string
  projectId: string
}

// Common data types
export interface PostHogPerson {
  id: string
  name: string
  distinct_ids: string[]
  properties: Record<string, any>
  created_at: string
  uuid: string
}

export interface PostHogEvent {
  id: string
  distinct_id: string
  properties: Record<string, any>
  event: string
  timestamp: string
  person?: PostHogPerson
}

export interface PostHogFeatureFlag {
  id: number
  name: string
  key: string
  filters: Record<string, any>
  deleted: boolean
  active: boolean
  created_at: string
  created_by: any
  is_simple_flag: boolean
  rollout_percentage?: number
  ensure_experience_continuity?: boolean
}

export interface PostHogInsight {
  id: number
  name: string
  description: string
  favorited: boolean
  filters: Record<string, any>
  query?: Record<string, any>
  result?: any
  created_at: string
  created_by: any
  last_modified_at: string
  last_modified_by: any
  deleted: boolean
  saved: boolean
  short_id: string
}

export interface PostHogDashboard {
  id: number
  name: string
  description: string
  pinned: boolean
  created_at: string
  created_by: any
  is_shared: boolean
  deleted: boolean
  creation_mode: string
  restriction_level: number
  filters: Record<string, any>
  tiles: any[]
}

export interface PostHogCohort {
  id: number
  name: string
  description: string
  groups: any[]
  filters?: Record<string, any>
  query?: Record<string, any>
  is_calculating: boolean
  count?: number
  created_at: string
  created_by: any
  deleted: boolean
  is_static: boolean
  version?: number
}

export interface PostHogExperiment {
  id: number
  name: string
  description: string
  feature_flag_key: string
  feature_flag: any
  parameters: Record<string, any>
  filters: Record<string, any>
  start_date?: string
  end_date?: string
  created_at: string
  created_by: any
  archived: boolean
}

export interface PostHogSurvey {
  id: string
  name: string
  description: string
  type: 'popover' | 'api'
  questions: any[]
  appearance?: Record<string, any>
  conditions?: Record<string, any>
  start_date?: string
  end_date?: string
  archived: boolean
  created_at: string
  created_by: any
}

export interface PostHogSessionRecording {
  id: string
  distinct_id: string
  viewed: boolean
  recording_duration: number
  start_time: string
  end_time: string
  click_count: number
  keypress_count: number
  console_error_count: number
  console_warn_count: number
  console_log_count: number
  person?: PostHogPerson
}

export interface PostHogAnnotation {
  id: number
  content: string
  date_marker: string
  created_at: string
  updated_at: string
  created_by: any
  dashboard_item?: number
  scope: string
  deleted: boolean
}

export interface PostHogEventDefinition {
  id: string
  name: string
  description: string
  tags: string[]
  volume_30_day?: number
  query_usage_30_day?: number
  created_at: string
  last_seen_at?: string
  verified: boolean
}

export interface PostHogPropertyDefinition {
  id: string
  name: string
  description: string
  tags: string[]
  is_numerical: boolean
  property_type: 'DateTime' | 'String' | 'Numeric' | 'Boolean'
  volume_30_day?: number
  query_usage_30_day?: number
  verified: boolean
}

export interface PostHogProject {
  id: number
  uuid: string
  organization: string
  api_token: string
  app_urls: string[]
  name: string
  slack_incoming_webhook?: string
  created_at: string
  updated_at: string
  anonymize_ips: boolean
  completed_snippet_onboarding: boolean
  ingested_event: boolean
  test_account_filters: any[]
  is_demo: boolean
}

export interface PostHogOrganization {
  id: string
  name: string
  created_at: string
  updated_at: string
  membership_level?: number
  personalization?: Record<string, any>
  setup?: Record<string, any>
  available_features: string[]
  is_member_join_email_enabled: boolean
}

// Union type for all PostHog responses
export type PostHogResponse = ToolResponse
