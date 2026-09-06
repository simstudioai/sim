import type { z } from 'zod'
import type {
  approveDeploymentInputSchema,
  cancelBuildRunInputSchema,
  cancelDeploymentInputSchema,
  createBuildPipelineInputSchema,
  createBuildPipelineStageInputSchema,
  createBuildRunInputSchema,
  createConnectionInputSchema,
  createDeployArtifactInputSchema,
  createDeployEnvironmentInputSchema,
  createDeploymentInputSchema,
  createDeployPipelineInputSchema,
  createDeployStageInputSchema,
  createProjectInputSchema,
  createRepositoryInputSchema,
  createTriggerInputSchema,
  deleteBuildPipelineInputSchema,
  deleteBuildPipelineStageInputSchema,
  deleteConnectionInputSchema,
  deleteDeployArtifactInputSchema,
  deleteDeployEnvironmentInputSchema,
  deleteDeployPipelineInputSchema,
  deleteDeployStageInputSchema,
  deleteProjectInputSchema,
  deleteRepositoryInputSchema,
  deleteTriggerInputSchema,
  getBuildPipelineInputSchema,
  getBuildPipelineStageInputSchema,
  getBuildRunInputSchema,
  getCommitInputSchema,
  getConnectionInputSchema,
  getDeployArtifactInputSchema,
  getDeployEnvironmentInputSchema,
  getDeploymentInputSchema,
  getDeployPipelineInputSchema,
  getDeployStageInputSchema,
  getProjectInputSchema,
  getRepositoryInputSchema,
  getTriggerInputSchema,
  getWorkRequestInputSchema,
  listBuildPipelineStagesInputSchema,
  listBuildPipelinesInputSchema,
  listBuildRunsInputSchema,
  listCommitsInputSchema,
  listConnectionsInputSchema,
  listDeployArtifactsInputSchema,
  listDeployEnvironmentsInputSchema,
  listDeploymentsInputSchema,
  listDeployPipelinesInputSchema,
  listDeployStagesInputSchema,
  listPathsInputSchema,
  listProjectsInputSchema,
  listRefsInputSchema,
  listRepositoriesInputSchema,
  listTriggersInputSchema,
  listWorkRequestErrorsInputSchema,
  listWorkRequestsInputSchema,
  operationSchemas,
  resourceSchema,
  updateBuildPipelineInputSchema,
  updateBuildPipelineStageInputSchema,
  updateBuildRunInputSchema,
  updateConnectionInputSchema,
  updateDeployArtifactInputSchema,
  updateDeployEnvironmentInputSchema,
  updateDeploymentInputSchema,
  updateDeployPipelineInputSchema,
  updateDeployStageInputSchema,
  updateProjectInputSchema,
  updateRepositoryInputSchema,
  updateTriggerInputSchema,
  validateConnectionInputSchema,
} from '@/lib/internal/oci-devops/schema'
import type { ToolResponse } from '@/tools/types'

export type OciDevopsAction = keyof typeof operationSchemas
export type OciDevopsResource = z.output<typeof resourceSchema> & {
  terminal: boolean
  succeeded: boolean | null
}
export interface OciDevopsResponse extends ToolResponse {
  output: {
    resource?: OciDevopsResource
    items?: OciDevopsResource[]
    nextPage?: string
    etag?: string
    requestId?: string
    workRequestId?: string
    accepted: boolean
    retryAfterSeconds?: number
  }
}

export type OciDevopsApproveDeploymentParams = z.input<typeof approveDeploymentInputSchema>
export type OciDevopsCancelBuildRunParams = z.input<typeof cancelBuildRunInputSchema>
export type OciDevopsCancelDeploymentParams = z.input<typeof cancelDeploymentInputSchema>
export type OciDevopsCreateBuildPipelineParams = z.input<typeof createBuildPipelineInputSchema>
export type OciDevopsCreateBuildPipelineStageParams = z.input<
  typeof createBuildPipelineStageInputSchema
>
export type OciDevopsCreateBuildRunParams = z.input<typeof createBuildRunInputSchema>
export type OciDevopsCreateConnectionParams = z.input<typeof createConnectionInputSchema>
export type OciDevopsCreateDeployArtifactParams = z.input<typeof createDeployArtifactInputSchema>
export type OciDevopsCreateDeployEnvironmentParams = z.input<
  typeof createDeployEnvironmentInputSchema
>
export type OciDevopsCreateDeployPipelineParams = z.input<typeof createDeployPipelineInputSchema>
export type OciDevopsCreateDeployStageParams = z.input<typeof createDeployStageInputSchema>
export type OciDevopsCreateDeploymentParams = z.input<typeof createDeploymentInputSchema>
export type OciDevopsCreateProjectParams = z.input<typeof createProjectInputSchema>
export type OciDevopsCreateRepositoryParams = z.input<typeof createRepositoryInputSchema>
export type OciDevopsCreateTriggerParams = z.input<typeof createTriggerInputSchema>
export type OciDevopsDeleteBuildPipelineParams = z.input<typeof deleteBuildPipelineInputSchema>
export type OciDevopsDeleteBuildPipelineStageParams = z.input<
  typeof deleteBuildPipelineStageInputSchema
>
export type OciDevopsDeleteConnectionParams = z.input<typeof deleteConnectionInputSchema>
export type OciDevopsDeleteDeployArtifactParams = z.input<typeof deleteDeployArtifactInputSchema>
export type OciDevopsDeleteDeployEnvironmentParams = z.input<
  typeof deleteDeployEnvironmentInputSchema
>
export type OciDevopsDeleteDeployPipelineParams = z.input<typeof deleteDeployPipelineInputSchema>
export type OciDevopsDeleteDeployStageParams = z.input<typeof deleteDeployStageInputSchema>
export type OciDevopsDeleteProjectParams = z.input<typeof deleteProjectInputSchema>
export type OciDevopsDeleteRepositoryParams = z.input<typeof deleteRepositoryInputSchema>
export type OciDevopsDeleteTriggerParams = z.input<typeof deleteTriggerInputSchema>
export type OciDevopsGetBuildPipelineParams = z.input<typeof getBuildPipelineInputSchema>
export type OciDevopsGetBuildPipelineStageParams = z.input<typeof getBuildPipelineStageInputSchema>
export type OciDevopsGetBuildRunParams = z.input<typeof getBuildRunInputSchema>
export type OciDevopsGetCommitParams = z.input<typeof getCommitInputSchema>
export type OciDevopsGetConnectionParams = z.input<typeof getConnectionInputSchema>
export type OciDevopsGetDeployArtifactParams = z.input<typeof getDeployArtifactInputSchema>
export type OciDevopsGetDeployEnvironmentParams = z.input<typeof getDeployEnvironmentInputSchema>
export type OciDevopsGetDeployPipelineParams = z.input<typeof getDeployPipelineInputSchema>
export type OciDevopsGetDeployStageParams = z.input<typeof getDeployStageInputSchema>
export type OciDevopsGetDeploymentParams = z.input<typeof getDeploymentInputSchema>
export type OciDevopsGetProjectParams = z.input<typeof getProjectInputSchema>
export type OciDevopsGetRepositoryParams = z.input<typeof getRepositoryInputSchema>
export type OciDevopsGetTriggerParams = z.input<typeof getTriggerInputSchema>
export type OciDevopsGetWorkRequestParams = z.input<typeof getWorkRequestInputSchema>
export type OciDevopsListBuildPipelineStagesParams = z.input<
  typeof listBuildPipelineStagesInputSchema
>
export type OciDevopsListBuildPipelinesParams = z.input<typeof listBuildPipelinesInputSchema>
export type OciDevopsListBuildRunsParams = z.input<typeof listBuildRunsInputSchema>
export type OciDevopsListCommitsParams = z.input<typeof listCommitsInputSchema>
export type OciDevopsListConnectionsParams = z.input<typeof listConnectionsInputSchema>
export type OciDevopsListDeployArtifactsParams = z.input<typeof listDeployArtifactsInputSchema>
export type OciDevopsListDeployEnvironmentsParams = z.input<
  typeof listDeployEnvironmentsInputSchema
>
export type OciDevopsListDeployPipelinesParams = z.input<typeof listDeployPipelinesInputSchema>
export type OciDevopsListDeployStagesParams = z.input<typeof listDeployStagesInputSchema>
export type OciDevopsListDeploymentsParams = z.input<typeof listDeploymentsInputSchema>
export type OciDevopsListPathsParams = z.input<typeof listPathsInputSchema>
export type OciDevopsListProjectsParams = z.input<typeof listProjectsInputSchema>
export type OciDevopsListRefsParams = z.input<typeof listRefsInputSchema>
export type OciDevopsListRepositoriesParams = z.input<typeof listRepositoriesInputSchema>
export type OciDevopsListTriggersParams = z.input<typeof listTriggersInputSchema>
export type OciDevopsListWorkRequestErrorsParams = z.input<typeof listWorkRequestErrorsInputSchema>
export type OciDevopsListWorkRequestsParams = z.input<typeof listWorkRequestsInputSchema>
export type OciDevopsUpdateBuildPipelineParams = z.input<typeof updateBuildPipelineInputSchema>
export type OciDevopsUpdateBuildPipelineStageParams = z.input<
  typeof updateBuildPipelineStageInputSchema
>
export type OciDevopsUpdateBuildRunParams = z.input<typeof updateBuildRunInputSchema>
export type OciDevopsUpdateConnectionParams = z.input<typeof updateConnectionInputSchema>
export type OciDevopsUpdateDeployArtifactParams = z.input<typeof updateDeployArtifactInputSchema>
export type OciDevopsUpdateDeployEnvironmentParams = z.input<
  typeof updateDeployEnvironmentInputSchema
>
export type OciDevopsUpdateDeployPipelineParams = z.input<typeof updateDeployPipelineInputSchema>
export type OciDevopsUpdateDeployStageParams = z.input<typeof updateDeployStageInputSchema>
export type OciDevopsUpdateDeploymentParams = z.input<typeof updateDeploymentInputSchema>
export type OciDevopsUpdateProjectParams = z.input<typeof updateProjectInputSchema>
export type OciDevopsUpdateRepositoryParams = z.input<typeof updateRepositoryInputSchema>
export type OciDevopsUpdateTriggerParams = z.input<typeof updateTriggerInputSchema>
export type OciDevopsValidateConnectionParams = z.input<typeof validateConnectionInputSchema>
