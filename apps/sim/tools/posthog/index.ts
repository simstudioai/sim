// Core Data Operations

import { batchEventsTool } from '@/tools/posthog/batch_events'
import { captureEventTool } from '@/tools/posthog/capture_event'
import { createAnnotationTool } from '@/tools/posthog/create_annotation'
import { createCohortTool } from '@/tools/posthog/create_cohort'
import { createExperimentTool } from '@/tools/posthog/create_experiment'
import { createFeatureFlagTool } from '@/tools/posthog/create_feature_flag'
import { createInsightTool } from '@/tools/posthog/create_insight'
import { createSurveyTool } from '@/tools/posthog/create_survey'
import { deleteFeatureFlagTool } from '@/tools/posthog/delete_feature_flag'
import { deletePersonTool } from '@/tools/posthog/delete_person'
import { evaluateFlagsTool } from '@/tools/posthog/evaluate_flags'
import { getCohortTool } from '@/tools/posthog/get_cohort'
import { getDashboardTool } from '@/tools/posthog/get_dashboard'
import { getEventDefinitionTool } from '@/tools/posthog/get_event_definition'
import { getExperimentTool } from '@/tools/posthog/get_experiment'
import { getFeatureFlagTool } from '@/tools/posthog/get_feature_flag'
import { getInsightTool } from '@/tools/posthog/get_insight'
import { getOrganizationTool } from '@/tools/posthog/get_organization'
import { getPersonTool } from '@/tools/posthog/get_person'
import { getProjectTool } from '@/tools/posthog/get_project'
import { getPropertyDefinitionTool } from '@/tools/posthog/get_property_definition'
import { getSessionRecordingTool } from '@/tools/posthog/get_session_recording'
import { getSurveyTool } from '@/tools/posthog/get_survey'
import { listActionsTool } from '@/tools/posthog/list_actions'
import { listAnnotationsTool } from '@/tools/posthog/list_annotations'
import { listCohortsTool } from '@/tools/posthog/list_cohorts'
import { listDashboardsTool } from '@/tools/posthog/list_dashboards'
// Data Management
import { listEventDefinitionsTool } from '@/tools/posthog/list_event_definitions'
import { listExperimentsTool } from '@/tools/posthog/list_experiments'
// Feature Management
import { listFeatureFlagsTool } from '@/tools/posthog/list_feature_flags'
// Analytics
import { listInsightsTool } from '@/tools/posthog/list_insights'
import { listOrganizationsTool } from '@/tools/posthog/list_organizations'
import { listPersonsTool } from '@/tools/posthog/list_persons'
// Configuration
import { listProjectsTool } from '@/tools/posthog/list_projects'
import { listPropertyDefinitionsTool } from '@/tools/posthog/list_property_definitions'
import { listRecordingPlaylistsTool } from '@/tools/posthog/list_recording_playlists'
import { listSessionRecordingsTool } from '@/tools/posthog/list_session_recordings'
// Engagement
import { listSurveysTool } from '@/tools/posthog/list_surveys'
import { queryTool } from '@/tools/posthog/query'
import { updateEventDefinitionTool } from '@/tools/posthog/update_event_definition'
import { updateFeatureFlagTool } from '@/tools/posthog/update_feature_flag'
import { updatePropertyDefinitionTool } from '@/tools/posthog/update_property_definition'
import { updateSurveyTool } from '@/tools/posthog/update_survey'

// Export all tools with posthog prefix
export const posthogCaptureEventTool = captureEventTool
export const posthogBatchEventsTool = batchEventsTool
export const posthogListPersonsTool = listPersonsTool
export const posthogGetPersonTool = getPersonTool
export const posthogDeletePersonTool = deletePersonTool
export const posthogQueryTool = queryTool

export const posthogListInsightsTool = listInsightsTool
export const posthogGetInsightTool = getInsightTool
export const posthogCreateInsightTool = createInsightTool
export const posthogListDashboardsTool = listDashboardsTool
export const posthogGetDashboardTool = getDashboardTool
export const posthogListActionsTool = listActionsTool
export const posthogListCohortsTool = listCohortsTool
export const posthogGetCohortTool = getCohortTool
export const posthogCreateCohortTool = createCohortTool
export const posthogListAnnotationsTool = listAnnotationsTool
export const posthogCreateAnnotationTool = createAnnotationTool

export const posthogListFeatureFlagsTool = listFeatureFlagsTool
export const posthogGetFeatureFlagTool = getFeatureFlagTool
export const posthogCreateFeatureFlagTool = createFeatureFlagTool
export const posthogUpdateFeatureFlagTool = updateFeatureFlagTool
export const posthogDeleteFeatureFlagTool = deleteFeatureFlagTool
export const posthogEvaluateFlagsTool = evaluateFlagsTool
export const posthogListExperimentsTool = listExperimentsTool
export const posthogGetExperimentTool = getExperimentTool
export const posthogCreateExperimentTool = createExperimentTool

export const posthogListSurveysTool = listSurveysTool
export const posthogGetSurveyTool = getSurveyTool
export const posthogCreateSurveyTool = createSurveyTool
export const posthogUpdateSurveyTool = updateSurveyTool
export const posthogListSessionRecordingsTool = listSessionRecordingsTool
export const posthogGetSessionRecordingTool = getSessionRecordingTool
export const posthogListRecordingPlaylistsTool = listRecordingPlaylistsTool

export const posthogListEventDefinitionsTool = listEventDefinitionsTool
export const posthogGetEventDefinitionTool = getEventDefinitionTool
export const posthogUpdateEventDefinitionTool = updateEventDefinitionTool
export const posthogListPropertyDefinitionsTool = listPropertyDefinitionsTool
export const posthogGetPropertyDefinitionTool = getPropertyDefinitionTool
export const posthogUpdatePropertyDefinitionTool = updatePropertyDefinitionTool

export const posthogListProjectsTool = listProjectsTool
export const posthogGetProjectTool = getProjectTool
export const posthogListOrganizationsTool = listOrganizationsTool
export const posthogGetOrganizationTool = getOrganizationTool
