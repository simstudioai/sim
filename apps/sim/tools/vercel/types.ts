import type { ToolResponse } from '@/tools/types'

export interface VercelListDeploymentsParams {
  apiKey: string
  projectId?: string
  target?: string
  state?: string
  app?: string
  since?: number
  until?: number
  limit?: number
  teamId?: string
}

export interface VercelGetDeploymentParams {
  apiKey: string
  deploymentId: string
  withGitRepoInfo?: string
  teamId?: string
}

export interface VercelListProjectsParams {
  apiKey: string
  search?: string
  limit?: number
  teamId?: string
}

export interface VercelGetProjectParams {
  apiKey: string
  projectId: string
  teamId?: string
}

export interface VercelCreateDeploymentParams {
  apiKey: string
  name: string
  project?: string
  deploymentId?: string
  target?: string
  gitSource?: string
  forceNew?: string
  teamId?: string
}

export interface VercelListDomainsParams {
  apiKey: string
  limit?: number
  teamId?: string
}

export interface VercelGetEnvVarsParams {
  apiKey: string
  projectId: string
  teamId?: string
}

export interface VercelListDeploymentsResponse extends ToolResponse {
  output: {
    deployments: Array<{
      uid: string
      name: string
      url: string | null
      state: string
      target: string | null
      created: number
      projectId: string
      source: string
      inspectorUrl: string
      creator: {
        uid: string
        email: string
        username: string
      }
      meta: Record<string, string>
    }>
    count: number
    hasMore: boolean
  }
}

export interface VercelGetDeploymentResponse extends ToolResponse {
  output: {
    id: string
    name: string
    url: string
    readyState: string
    status: string
    target: string | null
    createdAt: number
    buildingAt: number | null
    ready: number | null
    source: string
    alias: string[]
    regions: string[]
    inspectorUrl: string
    projectId: string
    creator: {
      uid: string
      username: string
    }
    project: {
      id: string
      name: string
      framework: string | null
    } | null
    meta: Record<string, string>
    gitSource: Record<string, unknown> | null
  }
}

export interface VercelListProjectsResponse extends ToolResponse {
  output: {
    projects: Array<{
      id: string
      name: string
      framework: string | null
      createdAt: number
      updatedAt: number
      domains: string[]
    }>
    count: number
    hasMore: boolean
  }
}

export interface VercelGetProjectResponse extends ToolResponse {
  output: {
    id: string
    name: string
    framework: string | null
    createdAt: number
    updatedAt: number
    domains: string[]
    link: {
      type: string
      repo: string
      org: string
    } | null
  }
}

export interface VercelCreateDeploymentResponse extends ToolResponse {
  output: {
    id: string
    name: string
    url: string
    readyState: string
    projectId: string
    createdAt: number
    alias: string[]
    target: string | null
    inspectorUrl: string
  }
}

export interface VercelListDomainsResponse extends ToolResponse {
  output: {
    domains: Array<{
      id: string
      name: string
      verified: boolean
      createdAt: number
      expiresAt: number | null
      serviceType: string
      nameservers: string[]
      intendedNameservers: string[]
      renew: boolean
      boughtAt: number | null
    }>
    count: number
    hasMore: boolean
  }
}

export interface VercelGetEnvVarsResponse extends ToolResponse {
  output: {
    envs: Array<{
      id: string
      key: string
      value: string
      type: string
      target: string[]
      gitBranch: string | null
      comment: string | null
    }>
    count: number
  }
}

export interface VercelCancelDeploymentParams {
  apiKey: string
  deploymentId: string
  teamId?: string
}

export interface VercelCancelDeploymentResponse extends ToolResponse {
  output: {
    id: string
    name: string | null
    state: string
    url: string | null
  }
}

export interface VercelDeleteDeploymentParams {
  apiKey: string
  deploymentId: string
  teamId?: string
}

export interface VercelDeleteDeploymentResponse extends ToolResponse {
  output: {
    uid: string | null
    state: string
  }
}

export interface VercelGetDeploymentEventsParams {
  apiKey: string
  deploymentId: string
  direction?: string
  follow?: number
  limit?: number
  since?: number
  until?: number
  teamId?: string
}

export interface VercelGetDeploymentEventsResponse extends ToolResponse {
  output: {
    events: Array<{
      type: string | null
      created: number | null
      date: number | null
      text: string | null
      serial: string | null
      deploymentId: string | null
      id: string | null
      level: string | null
    }>
    count: number
  }
}

export interface VercelCreateEnvVarParams {
  apiKey: string
  projectId: string
  key: string
  value: string
  target: string
  type?: string
  gitBranch?: string
  comment?: string
  teamId?: string
}

export interface VercelCreateEnvVarResponse extends ToolResponse {
  output: {
    id: string
    key: string
    value: string
    type: string
    target: string[]
    gitBranch: string | null
    comment: string | null
  }
}

export interface VercelUpdateEnvVarParams {
  apiKey: string
  projectId: string
  envId: string
  key?: string
  value?: string
  target?: string
  type?: string
  gitBranch?: string
  comment?: string
  teamId?: string
}

export interface VercelUpdateEnvVarResponse extends ToolResponse {
  output: {
    id: string
    key: string
    value: string
    type: string
    target: string[]
    gitBranch: string | null
    comment: string | null
  }
}

export interface VercelDeleteEnvVarParams {
  apiKey: string
  projectId: string
  envId: string
  teamId?: string
}

export interface VercelDeleteEnvVarResponse extends ToolResponse {
  output: {
    deleted: boolean
  }
}

export interface VercelListDeploymentFilesParams {
  apiKey: string
  deploymentId: string
  teamId?: string
}

export interface VercelListDeploymentFilesResponse extends ToolResponse {
  output: {
    files: Array<{
      name: string | null
      type: string | null
      uid: string | null
      mode: number | null
      contentType: string | null
      children: unknown[]
    }>
    count: number
  }
}

export interface VercelCreateProjectParams {
  apiKey: string
  name: string
  framework?: string
  gitRepository?: { type: string; repo: string }
  buildCommand?: string
  outputDirectory?: string
  installCommand?: string
  teamId?: string
}

export interface VercelCreateProjectResponse extends ToolResponse {
  output: {
    id: string
    name: string
    framework: string | null
    createdAt: number
    updatedAt: number
  }
}

export interface VercelUpdateProjectParams {
  apiKey: string
  projectId: string
  name?: string
  framework?: string
  buildCommand?: string
  outputDirectory?: string
  installCommand?: string
  teamId?: string
}

export interface VercelUpdateProjectResponse extends ToolResponse {
  output: {
    id: string
    name: string
    framework: string | null
    updatedAt: number
  }
}

export interface VercelDeleteProjectParams {
  apiKey: string
  projectId: string
  teamId?: string
}

export interface VercelDeleteProjectResponse extends ToolResponse {
  output: {
    deleted: boolean
  }
}

export interface VercelPauseProjectParams {
  apiKey: string
  projectId: string
  teamId?: string
}

export interface VercelPauseProjectResponse extends ToolResponse {
  output: {
    id: string
    name: string
    paused: boolean
  }
}

export interface VercelUnpauseProjectParams {
  apiKey: string
  projectId: string
  teamId?: string
}

export interface VercelUnpauseProjectResponse extends ToolResponse {
  output: {
    id: string
    name: string
    paused: boolean
  }
}

export interface VercelListProjectDomainsParams {
  apiKey: string
  projectId: string
  teamId?: string
  limit?: number
}

export interface VercelListProjectDomainsResponse extends ToolResponse {
  output: {
    domains: Array<{
      name: string
      apexName: string
      redirect: string | null
      redirectStatusCode: number | null
      verified: boolean
      gitBranch: string | null
      createdAt: number
      updatedAt: number
    }>
    count: number
    hasMore: boolean
  }
}

export interface VercelAddProjectDomainParams {
  apiKey: string
  projectId: string
  domain: string
  redirect?: string
  redirectStatusCode?: number
  gitBranch?: string
  teamId?: string
}

export interface VercelAddProjectDomainResponse extends ToolResponse {
  output: {
    name: string
    apexName: string
    verified: boolean
    gitBranch: string | null
    redirect: string | null
    redirectStatusCode: number | null
    createdAt: number
    updatedAt: number
  }
}

export interface VercelRemoveProjectDomainParams {
  apiKey: string
  projectId: string
  domain: string
  teamId?: string
}

export interface VercelRemoveProjectDomainResponse extends ToolResponse {
  output: {
    deleted: boolean
  }
}

export interface VercelGetDomainParams {
  apiKey: string
  domain: string
  teamId?: string
}

export interface VercelGetDomainResponse extends ToolResponse {
  output: {
    id: string | null
    name: string | null
    verified: boolean
    createdAt: number | null
    expiresAt: number | null
    serviceType: string | null
    nameservers: string[]
    intendedNameservers: string[]
    customNameservers: string[]
    renew: boolean
    boughtAt: number | null
    transferredAt: number | null
  }
}

export interface VercelAddDomainParams {
  apiKey: string
  name: string
  teamId?: string
}

export interface VercelAddDomainResponse extends ToolResponse {
  output: {
    id: string | null
    name: string | null
    verified: boolean
    createdAt: number | null
    serviceType: string | null
    nameservers: string[]
    intendedNameservers: string[]
  }
}

export interface VercelDeleteDomainParams {
  apiKey: string
  domain: string
  teamId?: string
}

export interface VercelDeleteDomainResponse extends ToolResponse {
  output: {
    uid: string | null
    deleted: boolean
  }
}

export interface VercelGetDomainConfigParams {
  apiKey: string
  domain: string
  teamId?: string
}

export interface VercelGetDomainConfigResponse extends ToolResponse {
  output: {
    configuredBy: string | null
    acceptedChallenges: string[]
    misconfigured: boolean
    recommendedIPv4: Array<{ rank: number; value: string[] }>
    recommendedCNAME: Array<{ rank: number; value: string }>
  }
}

export interface VercelCreateDnsRecordParams {
  apiKey: string
  domain: string
  recordName: string
  recordType: string
  value: string
  ttl?: number
  mxPriority?: number
  teamId?: string
}

export interface VercelCreateDnsRecordResponse extends ToolResponse {
  output: {
    uid: string | null
    updated: number | null
  }
}

export interface VercelListDnsRecordsParams {
  apiKey: string
  domain: string
  limit?: number
  teamId?: string
}

export interface VercelListDnsRecordsResponse extends ToolResponse {
  output: {
    records: Array<{
      id: string | null
      slug: string | null
      name: string | null
      type: string | null
      value: string | null
      ttl: number | null
      mxPriority: number | null
      priority: number | null
      creator: string | null
      createdAt: number | null
      updatedAt: number | null
      comment: string | null
    }>
    count: number
    hasMore: boolean
  }
}

export interface VercelDeleteDnsRecordParams {
  apiKey: string
  domain: string
  recordId: string
  teamId?: string
}

export interface VercelDeleteDnsRecordResponse extends ToolResponse {
  output: {
    deleted: boolean
  }
}

export interface VercelListTeamsParams {
  apiKey: string
  limit?: number
  since?: number
  until?: number
}

export interface VercelListTeamsResponse extends ToolResponse {
  output: {
    teams: Array<{
      id: string | null
      slug: string | null
      name: string | null
      avatar: string | null
      createdAt: number | null
      updatedAt: number | null
      creatorId: string | null
      membership: {
        role: string | null
        confirmed: boolean
        created: number | null
        uid: string | null
        teamId: string | null
      } | null
    }>
    count: number
    pagination: {
      count: number
      next: number | null
      prev: number | null
    } | null
  }
}

export interface VercelGetTeamParams {
  apiKey: string
  teamId: string
}

export interface VercelGetTeamResponse extends ToolResponse {
  output: {
    id: string | null
    slug: string | null
    name: string | null
    avatar: string | null
    description: string | null
    createdAt: number | null
    updatedAt: number | null
    creatorId: string | null
    membership: {
      uid: string | null
      teamId: string | null
      role: string | null
      confirmed: boolean
      created: number | null
      createdAt: number | null
      accessRequestedAt: number | null
      teamRoles: string[]
      teamPermissions: string[]
    } | null
  }
}

export interface VercelListTeamMembersParams {
  apiKey: string
  teamId: string
  limit?: number
  role?: string
  since?: number
  until?: number
  search?: string
}

export interface VercelListTeamMembersResponse extends ToolResponse {
  output: {
    members: Array<{
      uid: string | null
      email: string | null
      username: string | null
      name: string | null
      avatar: string | null
      role: string | null
      confirmed: boolean
      createdAt: number | null
      joinedFrom: {
        origin: string | null
      } | null
    }>
    count: number
    pagination: {
      hasNext: boolean
      count: number
    } | null
  }
}

export interface VercelGetUserParams {
  apiKey: string
}

export interface VercelGetUserResponse extends ToolResponse {
  output: {
    id: string | null
    email: string | null
    username: string | null
    name: string | null
    avatar: string | null
    defaultTeamId: string | null
    createdAt: number | null
    stagingPrefix: string | null
    softBlock: {
      blockedAt: number | null
      reason: string | null
    } | null
    hasTrialAvailable: boolean | null
  }
}

export interface VercelListAliasesParams {
  apiKey: string
  projectId?: string
  domain?: string
  limit?: number
  teamId?: string
}

export interface VercelListAliasesResponse extends ToolResponse {
  output: {
    aliases: Array<{
      uid: string | null
      alias: string | null
      deploymentId: string | null
      projectId: string | null
      createdAt: number | null
      updatedAt: number | null
    }>
    count: number
    hasMore: boolean
  }
}

export interface VercelGetAliasParams {
  apiKey: string
  aliasId: string
  teamId?: string
}

export interface VercelGetAliasResponse extends ToolResponse {
  output: {
    uid: string | null
    alias: string | null
    deploymentId: string | null
    projectId: string | null
    createdAt: number | null
    updatedAt: number | null
    redirect: string | null
    redirectStatusCode: number | null
  }
}

export interface VercelCreateAliasParams {
  apiKey: string
  deploymentId: string
  alias: string
  teamId?: string
}

export interface VercelCreateAliasResponse extends ToolResponse {
  output: {
    uid: string | null
    alias: string | null
    created: string | null
    oldDeploymentId: string | null
  }
}

export interface VercelDeleteAliasParams {
  apiKey: string
  aliasId: string
  teamId?: string
}

export interface VercelDeleteAliasResponse extends ToolResponse {
  output: {
    status: string
  }
}

export interface VercelListEdgeConfigsParams {
  apiKey: string
  teamId?: string
}

export interface VercelListEdgeConfigsResponse extends ToolResponse {
  output: {
    edgeConfigs: Array<{
      id: string | null
      slug: string | null
      ownerId: string | null
      digest: string | null
      createdAt: number | null
      updatedAt: number | null
      itemCount: number
      sizeInBytes: number
    }>
    count: number
  }
}

export interface VercelGetEdgeConfigParams {
  apiKey: string
  edgeConfigId: string
  teamId?: string
}

export interface VercelGetEdgeConfigResponse extends ToolResponse {
  output: {
    id: string | null
    slug: string | null
    ownerId: string | null
    digest: string | null
    createdAt: number | null
    updatedAt: number | null
    itemCount: number
    sizeInBytes: number
  }
}

export interface VercelCreateEdgeConfigParams {
  apiKey: string
  slug: string
  teamId?: string
}

export interface VercelCreateEdgeConfigResponse extends ToolResponse {
  output: {
    id: string | null
    slug: string | null
    ownerId: string | null
    digest: string | null
    createdAt: number | null
    updatedAt: number | null
    itemCount: number
    sizeInBytes: number
  }
}

export interface VercelGetEdgeConfigItemsParams {
  apiKey: string
  edgeConfigId: string
  teamId?: string
}

export interface VercelGetEdgeConfigItemsResponse extends ToolResponse {
  output: {
    items: Array<{
      key: string | null
      value: any
      description: string | null
      edgeConfigId: string | null
      createdAt: number | null
      updatedAt: number | null
    }>
    count: number
  }
}

export interface VercelUpdateEdgeConfigItemsParams {
  apiKey: string
  edgeConfigId: string
  items: string | Array<{ operation: string; key: string; value?: any; description?: string }>
  teamId?: string
}

export interface VercelUpdateEdgeConfigItemsResponse extends ToolResponse {
  output: {
    status: string
  }
}
