import { RailwayIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { RailwayResponse } from '@/tools/railway/types'

export const RailwayBlock: BlockConfig<RailwayResponse> = {
  type: 'railway',
  name: 'Railway',
  description: 'Manage Railway projects, deployments, and variables',
  longDescription:
    'Integrate Railway into workflows to list projects, inspect services and environments, monitor deployments, trigger service deployments, and manage environment variables.',
  docsLink: 'https://docs.sim.ai/tools/railway',
  category: 'tools',
  integrationType: IntegrationType.DeveloperTools,
  tags: ['cloud', 'ci-cd'],
  bgColor: '#FFFFFF',
  icon: RailwayIcon,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Projects', id: 'list_projects' },
        { label: 'Get Project', id: 'get_project' },
        { label: 'Create Project', id: 'create_project' },
        { label: 'Update Project', id: 'update_project' },
        { label: 'Delete Project', id: 'delete_project' },
        { label: 'Transfer Project', id: 'transfer_project' },
        { label: 'List Project Members', id: 'list_project_members' },
        { label: 'Create Environment', id: 'create_environment' },
        { label: 'Delete Environment', id: 'delete_environment' },
        { label: 'List Deployments', id: 'list_deployments' },
        { label: 'Deploy Service', id: 'deploy_service' },
        { label: 'List Variables', id: 'list_variables' },
        { label: 'Upsert Variable', id: 'upsert_variable' },
      ],
      value: () => 'list_projects',
    },
    {
      id: 'apiKey',
      title: 'API Token',
      type: 'short-input',
      placeholder: 'Enter Railway API token',
      password: true,
      required: true,
    },
    {
      id: 'tokenType',
      title: 'Token Type',
      type: 'dropdown',
      options: [
        { label: 'Account / Workspace / OAuth', id: 'account' },
        { label: 'Project', id: 'project' },
      ],
      value: () => 'account',
      mode: 'advanced',
    },
    {
      id: 'listProjectsWorkspaceId',
      title: 'Workspace ID',
      type: 'short-input',
      placeholder: 'Workspace ID',
      condition: { field: 'operation', value: 'list_projects' },
      mode: 'advanced',
    },
    {
      id: 'first',
      title: 'Limit',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: 'list_projects' },
      mode: 'advanced',
    },
    {
      id: 'after',
      title: 'After Cursor',
      type: 'short-input',
      placeholder: 'Cursor from a previous response',
      condition: { field: 'operation', value: 'list_projects' },
      mode: 'advanced',
    },
    {
      id: 'detailProjectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Railway project ID',
      condition: { field: 'operation', value: 'get_project' },
      required: { field: 'operation', value: 'get_project' },
    },
    {
      id: 'createProjectName',
      title: 'Project Name',
      type: 'short-input',
      placeholder: 'my-app',
      condition: { field: 'operation', value: 'create_project' },
      required: { field: 'operation', value: 'create_project' },
    },
    {
      id: 'createProjectDescription',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Project description',
      condition: { field: 'operation', value: 'create_project' },
      mode: 'advanced',
    },
    {
      id: 'createProjectWorkspaceId',
      title: 'Workspace ID',
      type: 'short-input',
      placeholder: 'Workspace ID',
      condition: { field: 'operation', value: 'create_project' },
      mode: 'advanced',
    },
    {
      id: 'createProjectIsPublic',
      title: 'Public Project',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'create_project' },
      mode: 'advanced',
    },
    {
      id: 'defaultEnvironmentName',
      title: 'Default Environment',
      type: 'short-input',
      placeholder: 'production',
      condition: { field: 'operation', value: 'create_project' },
      mode: 'advanced',
    },
    {
      id: 'prDeploys',
      title: 'PR Deploys',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'create_project' },
      mode: 'advanced',
    },
    {
      id: 'updateProjectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Railway project ID',
      condition: { field: 'operation', value: 'update_project' },
      required: { field: 'operation', value: 'update_project' },
    },
    {
      id: 'updateProjectName',
      title: 'Project Name',
      type: 'short-input',
      placeholder: 'Updated project name',
      condition: { field: 'operation', value: 'update_project' },
    },
    {
      id: 'updateProjectDescription',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Updated project description',
      condition: { field: 'operation', value: 'update_project' },
    },
    {
      id: 'updateProjectIsPublic',
      title: 'Public Project',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_project' },
      mode: 'advanced',
    },
    {
      id: 'updateProjectPrDeploys',
      title: 'PR Deploys',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_project' },
      mode: 'advanced',
    },
    {
      id: 'deleteProjectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Railway project ID',
      condition: { field: 'operation', value: 'delete_project' },
      required: { field: 'operation', value: 'delete_project' },
    },
    {
      id: 'transferProjectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Railway project ID',
      condition: { field: 'operation', value: 'transfer_project' },
      required: { field: 'operation', value: 'transfer_project' },
    },
    {
      id: 'workspaceId',
      title: 'Workspace ID',
      type: 'short-input',
      placeholder: 'Destination workspace ID',
      condition: { field: 'operation', value: 'transfer_project' },
      required: { field: 'operation', value: 'transfer_project' },
    },
    {
      id: 'membersProjectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Railway project ID',
      condition: { field: 'operation', value: 'list_project_members' },
      required: { field: 'operation', value: 'list_project_members' },
    },
    {
      id: 'createEnvironmentProjectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Railway project ID',
      condition: { field: 'operation', value: 'create_environment' },
      required: { field: 'operation', value: 'create_environment' },
    },
    {
      id: 'environmentName',
      title: 'Environment Name',
      type: 'short-input',
      placeholder: 'staging',
      condition: { field: 'operation', value: 'create_environment' },
      required: { field: 'operation', value: 'create_environment' },
    },
    {
      id: 'sourceEnvironmentId',
      title: 'Source Environment ID',
      type: 'short-input',
      placeholder: 'Environment ID to clone from',
      condition: { field: 'operation', value: 'create_environment' },
      mode: 'advanced',
    },
    {
      id: 'ephemeral',
      title: 'Ephemeral',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'create_environment' },
      mode: 'advanced',
    },
    {
      id: 'skipInitialDeploys',
      title: 'Skip Initial Deploys',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'create_environment' },
      mode: 'advanced',
    },
    {
      id: 'stageInitialChanges',
      title: 'Stage Initial Changes',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'create_environment' },
      mode: 'advanced',
    },
    {
      id: 'deleteEnvironmentId',
      title: 'Environment ID',
      type: 'short-input',
      placeholder: 'Railway environment ID',
      condition: { field: 'operation', value: 'delete_environment' },
      required: { field: 'operation', value: 'delete_environment' },
    },
    {
      id: 'deploymentProjectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Railway project ID',
      condition: { field: 'operation', value: 'list_deployments' },
      required: { field: 'operation', value: 'list_deployments' },
    },
    {
      id: 'deploymentServiceId',
      title: 'Service ID',
      type: 'short-input',
      placeholder: 'Railway service ID',
      condition: { field: 'operation', value: 'list_deployments' },
      required: { field: 'operation', value: 'list_deployments' },
    },
    {
      id: 'deploymentEnvironmentId',
      title: 'Environment ID',
      type: 'short-input',
      placeholder: 'Railway environment ID',
      condition: { field: 'operation', value: 'list_deployments' },
      required: { field: 'operation', value: 'list_deployments' },
    },
    {
      id: 'deploymentFirst',
      title: 'Limit',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'list_deployments' },
      mode: 'advanced',
    },
    {
      id: 'deploymentAfter',
      title: 'After Cursor',
      type: 'short-input',
      placeholder: 'Cursor from a previous response',
      condition: { field: 'operation', value: 'list_deployments' },
      mode: 'advanced',
    },
    {
      id: 'deployServiceId',
      title: 'Service ID',
      type: 'short-input',
      placeholder: 'Railway service ID',
      condition: { field: 'operation', value: 'deploy_service' },
      required: { field: 'operation', value: 'deploy_service' },
    },
    {
      id: 'deployEnvironmentId',
      title: 'Environment ID',
      type: 'short-input',
      placeholder: 'Railway environment ID',
      condition: { field: 'operation', value: 'deploy_service' },
      required: { field: 'operation', value: 'deploy_service' },
    },
    {
      id: 'deployCommitSha',
      title: 'Commit SHA',
      type: 'short-input',
      placeholder: 'abc123...',
      condition: { field: 'operation', value: 'deploy_service' },
      mode: 'advanced',
    },
    {
      id: 'variablesProjectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Railway project ID',
      condition: { field: 'operation', value: 'list_variables' },
      required: { field: 'operation', value: 'list_variables' },
    },
    {
      id: 'variablesEnvironmentId',
      title: 'Environment ID',
      type: 'short-input',
      placeholder: 'Railway environment ID',
      condition: { field: 'operation', value: 'list_variables' },
      required: { field: 'operation', value: 'list_variables' },
    },
    {
      id: 'variablesServiceId',
      title: 'Service ID',
      type: 'short-input',
      placeholder: 'Leave blank for shared variables',
      condition: { field: 'operation', value: 'list_variables' },
      mode: 'advanced',
    },
    {
      id: 'upsertProjectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Railway project ID',
      condition: { field: 'operation', value: 'upsert_variable' },
      required: { field: 'operation', value: 'upsert_variable' },
    },
    {
      id: 'upsertEnvironmentId',
      title: 'Environment ID',
      type: 'short-input',
      placeholder: 'Railway environment ID',
      condition: { field: 'operation', value: 'upsert_variable' },
      required: { field: 'operation', value: 'upsert_variable' },
    },
    {
      id: 'upsertServiceId',
      title: 'Service ID',
      type: 'short-input',
      placeholder: 'Leave blank for shared variables',
      condition: { field: 'operation', value: 'upsert_variable' },
      mode: 'advanced',
    },
    {
      id: 'variableName',
      title: 'Variable Name',
      type: 'short-input',
      placeholder: 'DATABASE_URL',
      condition: { field: 'operation', value: 'upsert_variable' },
      required: { field: 'operation', value: 'upsert_variable' },
    },
    {
      id: 'variableValue',
      title: 'Variable Value',
      type: 'long-input',
      placeholder: 'Variable value',
      condition: { field: 'operation', value: 'upsert_variable' },
      required: { field: 'operation', value: 'upsert_variable' },
    },
    {
      id: 'skipDeploys',
      title: 'Skip Deploys',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'upsert_variable' },
      mode: 'advanced',
    },
  ],

  tools: {
    access: [
      'railway_list_projects',
      'railway_get_project',
      'railway_create_project',
      'railway_update_project',
      'railway_delete_project',
      'railway_transfer_project',
      'railway_list_project_members',
      'railway_create_environment',
      'railway_delete_environment',
      'railway_list_deployments',
      'railway_deploy_service',
      'railway_list_variables',
      'railway_upsert_variable',
    ],
    config: {
      tool: (params) => `railway_${params.operation}`,
      params: (params) => {
        const baseParams = {
          apiKey: params.apiKey,
          tokenType: params.tokenType,
        }

        switch (params.operation) {
          case 'list_projects':
            return {
              ...baseParams,
              workspaceId: params.listProjectsWorkspaceId,
              first: params.first ? Number(params.first) : undefined,
              after: params.after,
            }
          case 'create_project':
            return {
              ...baseParams,
              name: params.createProjectName,
              description: params.createProjectDescription,
              workspaceId: params.createProjectWorkspaceId,
              isPublic: params.createProjectIsPublic
                ? params.createProjectIsPublic === 'true'
                : undefined,
              defaultEnvironmentName: params.defaultEnvironmentName,
              prDeploys: params.prDeploys ? params.prDeploys === 'true' : undefined,
            }
          case 'update_project':
            return {
              ...baseParams,
              projectId: params.updateProjectId,
              name: params.updateProjectName,
              description: params.updateProjectDescription,
              isPublic: params.updateProjectIsPublic
                ? params.updateProjectIsPublic === 'true'
                : undefined,
              prDeploys: params.updateProjectPrDeploys
                ? params.updateProjectPrDeploys === 'true'
                : undefined,
            }
          case 'delete_project':
            return {
              ...baseParams,
              projectId: params.deleteProjectId,
            }
          case 'transfer_project':
            return {
              ...baseParams,
              projectId: params.transferProjectId,
              workspaceId: params.workspaceId,
            }
          case 'list_project_members':
            return {
              ...baseParams,
              projectId: params.membersProjectId,
            }
          case 'create_environment':
            return {
              ...baseParams,
              projectId: params.createEnvironmentProjectId,
              name: params.environmentName,
              sourceEnvironmentId: params.sourceEnvironmentId,
              ephemeral: params.ephemeral ? params.ephemeral === 'true' : undefined,
              skipInitialDeploys: params.skipInitialDeploys
                ? params.skipInitialDeploys === 'true'
                : undefined,
              stageInitialChanges: params.stageInitialChanges
                ? params.stageInitialChanges === 'true'
                : undefined,
            }
          case 'delete_environment':
            return {
              ...baseParams,
              environmentId: params.deleteEnvironmentId,
            }
          case 'get_project':
            return {
              ...baseParams,
              projectId: params.detailProjectId,
            }
          case 'list_deployments':
            return {
              ...baseParams,
              projectId: params.deploymentProjectId,
              serviceId: params.deploymentServiceId,
              environmentId: params.deploymentEnvironmentId,
              first: params.deploymentFirst ? Number(params.deploymentFirst) : undefined,
              after: params.deploymentAfter,
            }
          case 'deploy_service':
            return {
              ...baseParams,
              serviceId: params.deployServiceId,
              environmentId: params.deployEnvironmentId,
              commitSha: params.deployCommitSha,
            }
          case 'list_variables':
            return {
              ...baseParams,
              projectId: params.variablesProjectId,
              environmentId: params.variablesEnvironmentId,
              serviceId: params.variablesServiceId,
            }
          case 'upsert_variable':
            return {
              ...baseParams,
              projectId: params.upsertProjectId,
              environmentId: params.upsertEnvironmentId,
              serviceId: params.upsertServiceId,
              name: params.variableName,
              value: params.variableValue,
              skipDeploys: params.skipDeploys ? params.skipDeploys === 'true' : undefined,
            }
          default:
            return baseParams
        }
      },
    },
  },

  inputs: {
    apiKey: { type: 'string', description: 'Railway API token' },
    tokenType: { type: 'string', description: 'Railway token type' },
    listProjectsWorkspaceId: { type: 'string', description: 'Workspace ID for project listing' },
    first: { type: 'number', description: 'List projects limit' },
    after: { type: 'string', description: 'List projects pagination cursor' },
    detailProjectId: { type: 'string', description: 'Project ID for project lookup' },
    createProjectName: { type: 'string', description: 'Project name to create' },
    createProjectDescription: { type: 'string', description: 'Project description to create' },
    createProjectWorkspaceId: { type: 'string', description: 'Workspace ID for created project' },
    createProjectIsPublic: { type: 'string', description: 'Whether the created project is public' },
    defaultEnvironmentName: { type: 'string', description: 'Default environment name' },
    prDeploys: { type: 'string', description: 'Whether to enable PR deploys' },
    updateProjectId: { type: 'string', description: 'Project ID to update' },
    updateProjectName: { type: 'string', description: 'Updated project name' },
    updateProjectDescription: { type: 'string', description: 'Updated project description' },
    updateProjectIsPublic: { type: 'string', description: 'Whether the project is public' },
    updateProjectPrDeploys: { type: 'string', description: 'Whether to enable PR deploys' },
    deleteProjectId: { type: 'string', description: 'Project ID to delete' },
    transferProjectId: { type: 'string', description: 'Project ID to transfer' },
    workspaceId: { type: 'string', description: 'Destination workspace ID' },
    membersProjectId: { type: 'string', description: 'Project ID for member listing' },
    createEnvironmentProjectId: { type: 'string', description: 'Project ID for new environment' },
    environmentName: { type: 'string', description: 'Environment name to create' },
    sourceEnvironmentId: { type: 'string', description: 'Environment ID to clone from' },
    ephemeral: { type: 'string', description: 'Whether the environment is ephemeral' },
    skipInitialDeploys: { type: 'string', description: 'Whether to skip initial deploys' },
    stageInitialChanges: { type: 'string', description: 'Whether to stage initial changes' },
    deleteEnvironmentId: { type: 'string', description: 'Environment ID to delete' },
    deploymentProjectId: { type: 'string', description: 'Project ID for deployments' },
    deploymentServiceId: { type: 'string', description: 'Service ID for deployments' },
    deploymentEnvironmentId: { type: 'string', description: 'Environment ID for deployments' },
    deploymentFirst: { type: 'number', description: 'List deployments limit' },
    deploymentAfter: { type: 'string', description: 'List deployments pagination cursor' },
    deployServiceId: { type: 'string', description: 'Service ID to deploy' },
    deployEnvironmentId: { type: 'string', description: 'Environment ID to deploy' },
    deployCommitSha: { type: 'string', description: 'Specific Git commit SHA to deploy' },
    variablesProjectId: { type: 'string', description: 'Project ID for variables' },
    variablesEnvironmentId: { type: 'string', description: 'Environment ID for variables' },
    variablesServiceId: { type: 'string', description: 'Optional service ID for variables' },
    upsertProjectId: { type: 'string', description: 'Project ID for variable upsert' },
    upsertEnvironmentId: { type: 'string', description: 'Environment ID for variable upsert' },
    upsertServiceId: { type: 'string', description: 'Optional service ID for variable upsert' },
    variableName: { type: 'string', description: 'Variable name' },
    variableValue: { type: 'string', description: 'Variable value' },
    skipDeploys: { type: 'string', description: 'Whether to skip deploys after variable upsert' },
  },

  outputs: {
    projects: { type: 'json', description: 'List of Railway projects' },
    project: { type: 'json', description: 'Railway project with services and environments' },
    members: { type: 'json', description: 'Railway project members (id, role, user)' },
    environment: { type: 'json', description: 'Railway environment (id, name)' },
    deployments: { type: 'json', description: 'List of Railway deployments' },
    variables: { type: 'json', description: 'Railway environment variables' },
    deploymentId: { type: 'string', description: 'Created deployment ID' },
    success: { type: 'boolean', description: 'Whether the operation succeeded' },
    count: { type: 'number', description: 'Number of items returned' },
    pageInfo: { type: 'json', description: 'Pagination information' },
  },
}
