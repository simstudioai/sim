import { BitbucketIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { getTrigger } from '@/triggers'

const WORKSPACE_FIELD = ['workspacePicker', 'workspaceSlugInput'] as const
const REPOSITORY_FIELD = ['repositoryPicker', 'repositorySlugInput'] as const

const OPERATIONS = [
  'bitbucket_list_workspaces',
  'bitbucket_list_repositories',
  'bitbucket_get_repository',
  'bitbucket_list_branches',
  'bitbucket_create_branch',
  'bitbucket_delete_branch',
  'bitbucket_list_commits',
  'bitbucket_get_commit',
  'bitbucket_list_directory',
  'bitbucket_get_file_metadata',
  'bitbucket_get_file',
  'bitbucket_list_pull_requests',
  'bitbucket_get_pull_request',
  'bitbucket_create_pull_request',
  'bitbucket_merge_pull_request',
  'bitbucket_get_pull_request_merge_task_status',
  'bitbucket_decline_pull_request',
  'bitbucket_approve_pull_request',
  'bitbucket_request_pull_request_changes',
  'bitbucket_get_pull_request_diff',
  'bitbucket_get_pull_request_diffstat',
  'bitbucket_list_pull_request_comments',
  'bitbucket_create_pull_request_comment',
  'bitbucket_list_pull_request_commit_statuses',
  'bitbucket_list_pipelines',
  'bitbucket_get_pipeline',
  'bitbucket_trigger_pipeline',
  'bitbucket_stop_pipeline',
  'bitbucket_list_pipeline_steps',
  'bitbucket_get_pipeline_step_log',
] as const

type BitbucketOperation = (typeof OPERATIONS)[number]

const PAGINATED_OPERATIONS: BitbucketOperation[] = [
  'bitbucket_list_workspaces',
  'bitbucket_list_repositories',
  'bitbucket_list_branches',
  'bitbucket_list_commits',
  'bitbucket_list_directory',
  'bitbucket_list_pull_requests',
  'bitbucket_get_pull_request_diffstat',
  'bitbucket_list_pull_request_comments',
  'bitbucket_list_pull_request_commit_statuses',
  'bitbucket_list_pipelines',
  'bitbucket_list_pipeline_steps',
]
const PULL_REQUEST_ID_OPERATIONS: BitbucketOperation[] = [
  'bitbucket_get_pull_request',
  'bitbucket_merge_pull_request',
  'bitbucket_get_pull_request_merge_task_status',
  'bitbucket_decline_pull_request',
  'bitbucket_approve_pull_request',
  'bitbucket_request_pull_request_changes',
  'bitbucket_get_pull_request_diff',
  'bitbucket_get_pull_request_diffstat',
  'bitbucket_list_pull_request_comments',
  'bitbucket_create_pull_request_comment',
  'bitbucket_list_pull_request_commit_statuses',
]
const PIPELINE_ID_OPERATIONS: BitbucketOperation[] = [
  'bitbucket_get_pipeline',
  'bitbucket_stop_pipeline',
  'bitbucket_list_pipeline_steps',
  'bitbucket_get_pipeline_step_log',
]

function isOmittedValue(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && !value.trim())
}

function optionalString(value: unknown, name: string): string | undefined {
  if (isOmittedValue(value)) return undefined
  if (typeof value !== 'string') throw new Error(`${name} must be a string`)
  return value.trim()
}

function optionalText(value: unknown, name: string): string | undefined {
  if (isOmittedValue(value)) return undefined
  if (typeof value !== 'string') throw new Error(`${name} must be a string`)
  return value
}

function optionalInteger(value: unknown, name: string): number | undefined {
  if (isOmittedValue(value)) return undefined

  let parsed: number
  if (typeof value === 'number') {
    parsed = value
  } else if (typeof value === 'string') {
    if (!/^[1-9]\d*$/.test(value)) {
      throw new Error(`${name} must be a positive integer`)
    }
    parsed = Number(value)
  } else {
    throw new Error(`${name} must be a positive integer`)
  }

  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive safe integer`)
  }
  return parsed
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (isOmittedValue(value)) return undefined
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  throw new Error(`${name} must be a boolean or the string "true" or "false"`)
}

function stringList(value: unknown, name: string): string[] | undefined {
  if (isOmittedValue(value)) return undefined

  if (Array.isArray(value)) {
    if (!value.every((item) => typeof item === 'string' && item.trim().length > 0)) {
      throw new Error(`${name} must contain only non-empty strings`)
    }
    return value.map((item) => item.trim())
  }
  if (typeof value !== 'string') {
    throw new Error(`${name} must be an array of strings or a comma-separated string`)
  }
  const values = value.split(',').map((item) => item.trim())
  if (values.some((item) => item.length === 0)) {
    throw new Error(`${name} must contain only non-empty strings`)
  }
  return values
}

function isBitbucketOperation(value: unknown): value is BitbucketOperation {
  return typeof value === 'string' && (OPERATIONS as readonly string[]).includes(value)
}

export const BitbucketBlock: BlockConfig = {
  type: 'bitbucket',
  name: 'Bitbucket',
  description: 'Work with Bitbucket Cloud repositories, pull requests, and pipelines',
  longDescription:
    'Connect Bitbucket Cloud to inspect repositories and source, collaborate on pull requests, diagnose or control pipelines, and start workflows from repository and pull request events. OAuth is used for actions and automatic webhook management.',
  docsLink: 'https://docs.sim.ai/integrations/bitbucket',
  category: 'tools',
  integrationType: IntegrationType.DevOps,
  authMode: AuthMode.OAuth,
  triggerAllowed: true,
  bgColor: '#FFFFFF',
  iconColor: '#2684FF',
  icon: BitbucketIcon,
  canvasPresentation: {
    defaultTitle: 'Bitbucket',
    operationRowTitle: 'Action',
    sentences: {
      byOperation: {
        bitbucket_list_workspaces: ['List workspaces'],
        bitbucket_list_repositories: [
          { text: 'List repositories in', field: WORKSPACE_FIELD, core: true },
        ],
        bitbucket_get_repository: [
          { text: 'Read repository', field: REPOSITORY_FIELD, core: true },
        ],
        bitbucket_list_branches: [
          { text: 'List branches in', field: REPOSITORY_FIELD, core: true },
        ],
        bitbucket_create_branch: [
          { text: 'Create branch', field: 'branchName', core: true },
          { text: 'from', field: 'target' },
          { text: 'in', field: REPOSITORY_FIELD },
        ],
        bitbucket_delete_branch: [
          { text: 'Delete branch', field: 'branchName', core: true },
          { text: 'from', field: REPOSITORY_FIELD },
        ],
        bitbucket_list_commits: [{ text: 'List commits in', field: REPOSITORY_FIELD, core: true }],
        bitbucket_get_commit: [
          { text: 'Read commit', field: 'revision', core: true },
          { text: 'in', field: REPOSITORY_FIELD },
        ],
        bitbucket_list_directory: [
          { text: 'List directory at', field: 'revision', core: true },
          { text: ', under', field: 'path' },
          { text: 'in', field: REPOSITORY_FIELD },
        ],
        bitbucket_get_file_metadata: [
          { text: 'Inspect file', field: 'path', core: true },
          { text: 'at', field: 'revision' },
        ],
        bitbucket_get_file: [
          { text: 'Read file', field: 'path', core: true },
          { text: 'at', field: 'revision' },
        ],
        bitbucket_list_pull_requests: [
          { text: 'List pull requests in', field: REPOSITORY_FIELD, core: true },
          { text: ', with state', field: 'state' },
        ],
        bitbucket_get_pull_request: [
          { text: 'Read pull request', field: 'prId', core: true },
          { text: 'in', field: REPOSITORY_FIELD },
        ],
        bitbucket_create_pull_request: [
          { text: 'Create pull request', field: 'title', core: true },
          { text: 'from', field: 'sourceBranch' },
          { text: 'into', field: 'destinationBranch' },
        ],
        bitbucket_merge_pull_request: [
          { text: 'Merge pull request', field: 'prId', core: true },
          { text: 'using', field: 'mergeStrategy' },
        ],
        bitbucket_get_pull_request_merge_task_status: [
          { text: 'Check merge task', field: 'taskId', core: true },
          { text: 'for pull request', field: 'prId' },
        ],
        bitbucket_decline_pull_request: [
          { text: 'Decline pull request', field: 'prId', core: true },
        ],
        bitbucket_approve_pull_request: [
          { text: 'Approve pull request', field: 'prId', core: true },
        ],
        bitbucket_request_pull_request_changes: [
          { text: 'Request changes on pull request', field: 'prId', core: true },
        ],
        bitbucket_get_pull_request_diff: [
          { text: 'Read diff for file', field: 'path', core: true },
          { text: 'in pull request', field: 'prId' },
        ],
        bitbucket_get_pull_request_diffstat: [
          { text: 'List changed files in pull request', field: 'prId', core: true },
        ],
        bitbucket_list_pull_request_comments: [
          { text: 'List comments on pull request', field: 'prId', core: true },
        ],
        bitbucket_create_pull_request_comment: [
          { text: 'Comment', field: 'content', core: true },
          { text: 'on pull request', field: 'prId' },
        ],
        bitbucket_list_pull_request_commit_statuses: [
          { text: 'List commit statuses for pull request', field: 'prId', core: true },
        ],
        bitbucket_list_pipelines: [
          { text: 'List pipelines in', field: REPOSITORY_FIELD, core: true },
        ],
        bitbucket_get_pipeline: [{ text: 'Read pipeline', field: 'pipelineUuid', core: true }],
        bitbucket_trigger_pipeline: [
          { text: 'Trigger pipeline on', field: 'targetRef', core: true },
          { text: 'in', field: REPOSITORY_FIELD },
        ],
        bitbucket_stop_pipeline: [{ text: 'Stop pipeline', field: 'pipelineUuid', core: true }],
        bitbucket_list_pipeline_steps: [
          { text: 'List steps in pipeline', field: 'pipelineUuid', core: true },
        ],
        bitbucket_get_pipeline_step_log: [
          { text: 'Read log for step', field: 'stepUuid', core: true },
          { text: 'in pipeline', field: 'pipelineUuid' },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Action',
      type: 'dropdown',
      options: [
        { label: 'List Workspaces', id: 'bitbucket_list_workspaces' },
        { label: 'List Repositories', id: 'bitbucket_list_repositories' },
        { label: 'Get Repository', id: 'bitbucket_get_repository' },
        { label: 'List Branches', id: 'bitbucket_list_branches' },
        { label: 'Create Branch', id: 'bitbucket_create_branch' },
        { label: 'Delete Branch', id: 'bitbucket_delete_branch' },
        { label: 'List Commits', id: 'bitbucket_list_commits' },
        { label: 'Get Commit', id: 'bitbucket_get_commit' },
        { label: 'List Directory', id: 'bitbucket_list_directory' },
        { label: 'Get File Metadata', id: 'bitbucket_get_file_metadata' },
        { label: 'Get File', id: 'bitbucket_get_file' },
        { label: 'List Pull Requests', id: 'bitbucket_list_pull_requests' },
        { label: 'Get Pull Request', id: 'bitbucket_get_pull_request' },
        { label: 'Create Pull Request', id: 'bitbucket_create_pull_request' },
        { label: 'Merge Pull Request', id: 'bitbucket_merge_pull_request' },
        {
          label: 'Get Pull Request Merge Task Status',
          id: 'bitbucket_get_pull_request_merge_task_status',
        },
        { label: 'Decline Pull Request', id: 'bitbucket_decline_pull_request' },
        { label: 'Approve Pull Request', id: 'bitbucket_approve_pull_request' },
        {
          label: 'Request Pull Request Changes',
          id: 'bitbucket_request_pull_request_changes',
        },
        { label: 'Get Pull Request Diff', id: 'bitbucket_get_pull_request_diff' },
        { label: 'Get Pull Request Diffstat', id: 'bitbucket_get_pull_request_diffstat' },
        { label: 'List Pull Request Comments', id: 'bitbucket_list_pull_request_comments' },
        { label: 'Create Pull Request Comment', id: 'bitbucket_create_pull_request_comment' },
        {
          label: 'List Pull Request Commit Statuses',
          id: 'bitbucket_list_pull_request_commit_statuses',
        },
        { label: 'List Pipelines', id: 'bitbucket_list_pipelines' },
        { label: 'Get Pipeline', id: 'bitbucket_get_pipeline' },
        { label: 'Trigger Pipeline', id: 'bitbucket_trigger_pipeline' },
        { label: 'Stop Pipeline', id: 'bitbucket_stop_pipeline' },
        { label: 'List Pipeline Steps', id: 'bitbucket_list_pipeline_steps' },
        { label: 'Get Pipeline Step Log', id: 'bitbucket_get_pipeline_step_log' },
      ],
      value: () => 'bitbucket_list_repositories',
    },
    {
      id: 'accountPicker',
      title: 'Bitbucket Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      serviceId: 'bitbucket',
      requiredScopes: [
        'account',
        'repository',
        'repository:write',
        'pullrequest',
        'pullrequest:write',
        'pipeline',
        'pipeline:write',
      ],
      placeholder: 'Select Bitbucket account',
      required: true,
    },
    {
      id: 'credentialIdInput',
      title: 'Bitbucket Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'workspacePicker',
      title: 'Workspace',
      type: 'project-selector',
      canonicalParamId: 'workspaceSlug',
      serviceId: 'bitbucket',
      selectorKey: 'bitbucket.workspaces',
      dependsOn: ['accountPicker'],
      mode: 'basic',
      condition: { field: 'operation', value: 'bitbucket_list_workspaces', not: true },
      required: { field: 'operation', value: 'bitbucket_list_workspaces', not: true },
      placeholder: 'Select Bitbucket workspace',
    },
    {
      id: 'workspaceSlugInput',
      title: 'Workspace Slug',
      type: 'short-input',
      canonicalParamId: 'workspaceSlug',
      dependsOn: ['credentialIdInput'],
      mode: 'advanced',
      condition: { field: 'operation', value: 'bitbucket_list_workspaces', not: true },
      required: { field: 'operation', value: 'bitbucket_list_workspaces', not: true },
      placeholder: 'Enter workspace slug',
    },
    {
      id: 'repositoryPicker',
      title: 'Repository',
      type: 'project-selector',
      canonicalParamId: 'repoSlug',
      serviceId: 'bitbucket',
      selectorKey: 'bitbucket.repositories',
      dependsOn: ['accountPicker', 'workspacePicker'],
      mode: 'basic',
      condition: {
        field: 'operation',
        value: ['bitbucket_list_workspaces', 'bitbucket_list_repositories'],
        not: true,
      },
      required: {
        field: 'operation',
        value: ['bitbucket_list_workspaces', 'bitbucket_list_repositories'],
        not: true,
      },
      placeholder: 'Select Bitbucket repository',
    },
    {
      id: 'repositorySlugInput',
      title: 'Repository Slug',
      type: 'short-input',
      canonicalParamId: 'repoSlug',
      dependsOn: ['credentialIdInput', 'workspaceSlugInput'],
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['bitbucket_list_workspaces', 'bitbucket_list_repositories'],
        not: true,
      },
      required: {
        field: 'operation',
        value: ['bitbucket_list_workspaces', 'bitbucket_list_repositories'],
        not: true,
      },
      placeholder: 'Enter repository slug',
    },
    {
      id: 'pageLen',
      title: 'Page Size',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: PAGINATED_OPERATIONS },
      placeholder: '1-100',
    },
    {
      id: 'nextUrl',
      title: 'Next Page URL',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: PAGINATED_OPERATIONS },
      placeholder: 'Validated URL returned by the previous page',
    },
    {
      id: 'query',
      title: 'Bitbucket Query',
      type: 'long-input',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'bitbucket_list_repositories',
          'bitbucket_list_branches',
          'bitbucket_list_directory',
          'bitbucket_list_pull_requests',
          'bitbucket_list_pull_request_comments',
          'bitbucket_list_pull_request_commit_statuses',
        ],
      },
      placeholder: 'Optional Bitbucket filtering expression',
    },
    {
      id: 'sort',
      title: 'Sort Expression',
      type: 'short-input',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'bitbucket_list_workspaces',
          'bitbucket_list_repositories',
          'bitbucket_list_branches',
          'bitbucket_list_directory',
          'bitbucket_list_pull_requests',
          'bitbucket_list_pull_request_comments',
          'bitbucket_list_pull_request_commit_statuses',
          'bitbucket_list_pipelines',
        ],
      },
      placeholder: 'For example: -updated_on',
    },
    {
      id: 'administrator',
      title: 'Administrator Access',
      type: 'dropdown',
      mode: 'advanced',
      condition: { field: 'operation', value: 'bitbucket_list_workspaces' },
      options: [
        { label: 'Any', id: '' },
        { label: 'Administrator', id: 'true' },
        { label: 'Not Administrator', id: 'false' },
      ],
    },
    {
      id: 'role',
      title: 'Repository Role',
      type: 'dropdown',
      mode: 'advanced',
      condition: { field: 'operation', value: 'bitbucket_list_repositories' },
      options: [
        { label: 'Any', id: '' },
        { label: 'Owner', id: 'owner' },
        { label: 'Administrator', id: 'admin' },
        { label: 'Contributor', id: 'contributor' },
        { label: 'Member', id: 'member' },
      ],
    },
    {
      id: 'branchName',
      title: 'Branch Name',
      type: 'short-input',
      required: true,
      condition: {
        field: 'operation',
        value: ['bitbucket_create_branch', 'bitbucket_delete_branch'],
      },
      placeholder: 'feature/my-branch',
    },
    {
      id: 'target',
      title: 'Start Point',
      type: 'short-input',
      required: true,
      condition: { field: 'operation', value: 'bitbucket_create_branch' },
      placeholder: 'Full commit hash or existing ref',
    },
    {
      id: 'revision',
      title: 'Commit SHA',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'bitbucket_get_commit',
          'bitbucket_list_directory',
          'bitbucket_get_file_metadata',
          'bitbucket_get_file',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'bitbucket_get_commit',
          'bitbucket_list_directory',
          'bitbucket_get_file_metadata',
          'bitbucket_get_file',
        ],
      },
      placeholder: 'Full 40-character commit SHA',
    },
    {
      id: 'path',
      title: 'Path',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'bitbucket_list_directory',
          'bitbucket_get_file_metadata',
          'bitbucket_get_file',
          'bitbucket_get_pull_request_diff',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'bitbucket_get_file_metadata',
          'bitbucket_get_file',
          'bitbucket_get_pull_request_diff',
        ],
      },
      placeholder: 'src/index.ts',
    },
    {
      id: 'state',
      title: 'Pull Request State',
      type: 'dropdown',
      mode: 'advanced',
      condition: { field: 'operation', value: 'bitbucket_list_pull_requests' },
      options: [
        { label: 'Open', id: 'OPEN' },
        { label: 'Merged', id: 'MERGED' },
        { label: 'Declined', id: 'DECLINED' },
        { label: 'Superseded', id: 'SUPERSEDED' },
      ],
    },
    {
      id: 'prId',
      title: 'Pull Request ID',
      type: 'short-input',
      required: true,
      condition: { field: 'operation', value: PULL_REQUEST_ID_OPERATIONS },
      placeholder: '123',
    },
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      required: true,
      condition: { field: 'operation', value: 'bitbucket_create_pull_request' },
    },
    {
      id: 'sourceBranch',
      title: 'Source Branch',
      type: 'short-input',
      required: true,
      condition: { field: 'operation', value: 'bitbucket_create_pull_request' },
    },
    {
      id: 'destinationBranch',
      title: 'Destination Branch',
      type: 'short-input',
      required: true,
      condition: { field: 'operation', value: 'bitbucket_create_pull_request' },
      placeholder: 'main',
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'bitbucket_create_pull_request' },
    },
    {
      id: 'reviewerAccountIds',
      title: 'Reviewer UUIDs',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'bitbucket_create_pull_request' },
      placeholder: 'Comma-separated Bitbucket user UUIDs',
    },
    {
      id: 'createCloseSourceBranch',
      title: 'Close Source Branch',
      type: 'dropdown',
      mode: 'advanced',
      condition: { field: 'operation', value: 'bitbucket_create_pull_request' },
      options: [
        { label: 'Unset', id: '' },
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
    },
    {
      id: 'mergeCloseSourceBranch',
      title: 'Close Source Branch',
      type: 'dropdown',
      mode: 'advanced',
      condition: { field: 'operation', value: 'bitbucket_merge_pull_request' },
      options: [
        { label: 'Unset', id: '' },
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
    },
    {
      id: 'draft',
      title: 'Draft Pull Request',
      type: 'dropdown',
      mode: 'advanced',
      condition: { field: 'operation', value: 'bitbucket_create_pull_request' },
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
    },
    {
      id: 'mergeStrategy',
      title: 'Merge Strategy',
      type: 'dropdown',
      mode: 'advanced',
      condition: { field: 'operation', value: 'bitbucket_merge_pull_request' },
      options: [
        { label: 'Merge Commit', id: 'merge_commit' },
        { label: 'Squash', id: 'squash' },
        { label: 'Fast Forward', id: 'fast_forward' },
        { label: 'Squash and Fast Forward', id: 'squash_fast_forward' },
        { label: 'Rebase and Fast Forward', id: 'rebase_fast_forward' },
        { label: 'Rebase and Merge', id: 'rebase_merge' },
      ],
    },
    {
      id: 'message',
      title: 'Merge Commit Message',
      type: 'long-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'bitbucket_merge_pull_request' },
    },
    {
      id: 'taskId',
      title: 'Merge Task ID',
      type: 'short-input',
      required: true,
      condition: {
        field: 'operation',
        value: 'bitbucket_get_pull_request_merge_task_status',
      },
    },
    {
      id: 'content',
      title: 'Comment',
      type: 'long-input',
      required: true,
      condition: { field: 'operation', value: 'bitbucket_create_pull_request_comment' },
    },
    {
      id: 'parentId',
      title: 'Parent Comment ID',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'bitbucket_create_pull_request_comment' },
      placeholder: 'Reply to an existing general comment',
    },
    {
      id: 'pipelineRefType',
      title: 'Pipeline Ref Type',
      type: 'dropdown',
      mode: 'advanced',
      condition: { field: 'operation', value: 'bitbucket_list_pipelines' },
      options: [
        { label: 'Any', id: '' },
        { label: 'Branch', id: 'BRANCH' },
        { label: 'Tag', id: 'TAG' },
        { label: 'Annotated Tag', id: 'ANNOTATED_TAG' },
      ],
    },
    {
      id: 'pipelineRefName',
      title: 'Pipeline Ref Name',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'bitbucket_list_pipelines' },
    },
    {
      id: 'pipelineCommitHash',
      title: 'Pipeline Commit SHA',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'bitbucket_list_pipelines' },
      placeholder: 'Full 40-character commit SHA',
    },
    {
      id: 'pipelineSelectorType',
      title: 'Pipeline Selector Type',
      type: 'dropdown',
      mode: 'advanced',
      condition: { field: 'operation', value: 'bitbucket_list_pipelines' },
      options: [
        { label: 'Any', id: '' },
        { label: 'Branch', id: 'BRANCH' },
        { label: 'Tag', id: 'TAG' },
        { label: 'Custom', id: 'CUSTOM' },
        { label: 'Pull Requests', id: 'PULLREQUESTS' },
        { label: 'Default', id: 'DEFAULT' },
      ],
    },
    {
      id: 'pipelineSelectorPattern',
      title: 'Pipeline Selector Pattern',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'bitbucket_list_pipelines' },
    },
    {
      id: 'pipelineTriggerType',
      title: 'Pipeline Trigger Type',
      type: 'dropdown',
      mode: 'advanced',
      condition: { field: 'operation', value: 'bitbucket_list_pipelines' },
      options: [
        { label: 'Any', id: '' },
        { label: 'Push', id: 'PUSH' },
        { label: 'Manual', id: 'MANUAL' },
        { label: 'Scheduled', id: 'SCHEDULED' },
        { label: 'Parent Step', id: 'PARENT_STEP' },
      ],
    },
    {
      id: 'pipelineStatus',
      title: 'Pipeline Status',
      type: 'dropdown',
      mode: 'advanced',
      condition: { field: 'operation', value: 'bitbucket_list_pipelines' },
      options: [
        { label: 'Any', id: '' },
        { label: 'Parsing', id: 'PARSING' },
        { label: 'Pending', id: 'PENDING' },
        { label: 'Paused', id: 'PAUSED' },
        { label: 'Halted', id: 'HALTED' },
        { label: 'Building', id: 'BUILDING' },
        { label: 'Error', id: 'ERROR' },
        { label: 'Passed', id: 'PASSED' },
        { label: 'Failed', id: 'FAILED' },
        { label: 'Stopped', id: 'STOPPED' },
        { label: 'Unknown', id: 'UNKNOWN' },
      ],
    },
    {
      id: 'pipelineUuid',
      title: 'Pipeline UUID',
      type: 'short-input',
      required: true,
      condition: { field: 'operation', value: PIPELINE_ID_OPERATIONS },
      placeholder: '{pipeline-uuid}',
    },
    {
      id: 'targetRef',
      title: 'Branch',
      type: 'short-input',
      required: true,
      condition: { field: 'operation', value: 'bitbucket_trigger_pipeline' },
      placeholder: 'main',
    },
    {
      id: 'targetCommitHash',
      title: 'Target Commit SHA',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'bitbucket_trigger_pipeline' },
      placeholder: 'Optional full commit SHA on the selected branch',
    },
    {
      id: 'stepUuid',
      title: 'Step UUID',
      type: 'short-input',
      required: true,
      condition: { field: 'operation', value: 'bitbucket_get_pipeline_step_log' },
      placeholder: '{step-uuid}',
    },
    {
      id: 'maxCharacters',
      title: 'Maximum Characters',
      type: 'short-input',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'bitbucket_get_file',
          'bitbucket_get_pull_request_diff',
          'bitbucket_get_pipeline_step_log',
        ],
      },
      placeholder: 'Maximum bounded content to return',
    },
    ...getTrigger('bitbucket_push').subBlocks,
    ...getTrigger('bitbucket_repository_forked').subBlocks,
    ...getTrigger('bitbucket_repository_updated').subBlocks,
    ...getTrigger('bitbucket_commit_comment_created').subBlocks,
    ...getTrigger('bitbucket_build_status_created').subBlocks,
    ...getTrigger('bitbucket_build_status_updated').subBlocks,
    ...getTrigger('bitbucket_pull_request_created').subBlocks,
    ...getTrigger('bitbucket_pull_request_updated').subBlocks,
    ...getTrigger('bitbucket_pull_request_approved').subBlocks,
    ...getTrigger('bitbucket_pull_request_approval_removed').subBlocks,
    ...getTrigger('bitbucket_pull_request_changes_requested').subBlocks,
    ...getTrigger('bitbucket_pull_request_changes_request_removed').subBlocks,
    ...getTrigger('bitbucket_pull_request_merged').subBlocks,
    ...getTrigger('bitbucket_pull_request_declined').subBlocks,
    ...getTrigger('bitbucket_pull_request_comment_created').subBlocks,
    ...getTrigger('bitbucket_pull_request_comment_updated').subBlocks,
    ...getTrigger('bitbucket_pull_request_comment_deleted').subBlocks,
    ...getTrigger('bitbucket_pull_request_comment_resolved').subBlocks,
    ...getTrigger('bitbucket_pull_request_comment_reopened').subBlocks,
  ],
  tools: {
    // Keep this list literal so the documentation generator can statically discover every action.
    access: [
      'bitbucket_list_workspaces',
      'bitbucket_list_repositories',
      'bitbucket_get_repository',
      'bitbucket_list_branches',
      'bitbucket_create_branch',
      'bitbucket_delete_branch',
      'bitbucket_list_commits',
      'bitbucket_get_commit',
      'bitbucket_list_directory',
      'bitbucket_get_file_metadata',
      'bitbucket_get_file',
      'bitbucket_list_pull_requests',
      'bitbucket_get_pull_request',
      'bitbucket_create_pull_request',
      'bitbucket_merge_pull_request',
      'bitbucket_get_pull_request_merge_task_status',
      'bitbucket_decline_pull_request',
      'bitbucket_approve_pull_request',
      'bitbucket_request_pull_request_changes',
      'bitbucket_get_pull_request_diff',
      'bitbucket_get_pull_request_diffstat',
      'bitbucket_list_pull_request_comments',
      'bitbucket_create_pull_request_comment',
      'bitbucket_list_pull_request_commit_statuses',
      'bitbucket_list_pipelines',
      'bitbucket_get_pipeline',
      'bitbucket_trigger_pipeline',
      'bitbucket_stop_pipeline',
      'bitbucket_list_pipeline_steps',
      'bitbucket_get_pipeline_step_log',
    ],
    config: {
      tool: (params) => {
        if (!isBitbucketOperation(params.operation)) {
          throw new Error(`Invalid Bitbucket operation: ${String(params.operation)}`)
        }
        return params.operation
      },
      params: (params) => {
        if (!isBitbucketOperation(params.operation)) {
          throw new Error(`Invalid Bitbucket operation: ${String(params.operation)}`)
        }

        const common = {
          oauthCredential: params.oauthCredential,
          workspaceSlug: optionalString(params.workspaceSlug, 'workspaceSlug'),
          repoSlug: optionalString(params.repoSlug, 'repoSlug'),
        }
        const pagination = {
          pageLen: optionalInteger(params.pageLen, 'pageLen'),
          nextUrl: optionalString(params.nextUrl, 'nextUrl'),
        }

        switch (params.operation) {
          case 'bitbucket_list_workspaces':
            return {
              oauthCredential: params.oauthCredential,
              sort: optionalString(params.sort, 'sort'),
              administrator: optionalBoolean(params.administrator, 'administrator'),
              ...pagination,
            }
          case 'bitbucket_list_repositories':
            return {
              oauthCredential: params.oauthCredential,
              workspaceSlug: optionalString(params.workspaceSlug, 'workspaceSlug'),
              role: optionalString(params.role, 'role'),
              q: optionalString(params.query, 'query'),
              sort: optionalString(params.sort, 'sort'),
              ...pagination,
            }
          case 'bitbucket_list_branches':
            return {
              ...common,
              q: optionalString(params.query, 'query'),
              sort: optionalString(params.sort, 'sort'),
              ...pagination,
            }
          case 'bitbucket_list_pipelines':
            return {
              ...common,
              refType: optionalString(params.pipelineRefType, 'pipelineRefType'),
              refName: optionalString(params.pipelineRefName, 'pipelineRefName'),
              commitHash: optionalString(params.pipelineCommitHash, 'pipelineCommitHash'),
              selectorType: optionalString(params.pipelineSelectorType, 'pipelineSelectorType'),
              selectorPattern: optionalString(
                params.pipelineSelectorPattern,
                'pipelineSelectorPattern'
              ),
              triggerType: optionalString(params.pipelineTriggerType, 'pipelineTriggerType'),
              status: optionalString(params.pipelineStatus, 'pipelineStatus'),
              sort: optionalString(params.sort, 'sort'),
              ...pagination,
            }
          case 'bitbucket_get_repository':
            return common
          case 'bitbucket_create_branch':
            return {
              ...common,
              name: optionalString(params.branchName, 'branchName'),
              target: optionalString(params.target, 'target'),
            }
          case 'bitbucket_delete_branch':
            return { ...common, name: optionalString(params.branchName, 'branchName') }
          case 'bitbucket_list_commits':
            return { ...common, ...pagination }
          case 'bitbucket_get_commit':
            return { ...common, commit: optionalString(params.revision, 'revision') }
          case 'bitbucket_list_directory':
            return {
              ...common,
              commit: optionalString(params.revision, 'revision'),
              path: optionalText(params.path, 'path'),
              q: optionalString(params.query, 'query'),
              sort: optionalString(params.sort, 'sort'),
              ...pagination,
            }
          case 'bitbucket_get_file_metadata':
            return {
              ...common,
              commit: optionalString(params.revision, 'revision'),
              path: optionalText(params.path, 'path'),
            }
          case 'bitbucket_get_file':
            return {
              ...common,
              commit: optionalString(params.revision, 'revision'),
              path: optionalText(params.path, 'path'),
              maxCharacters: optionalInteger(params.maxCharacters, 'maxCharacters'),
            }
          case 'bitbucket_list_pull_requests':
            return {
              ...common,
              state: optionalString(params.state, 'state'),
              q: optionalString(params.query, 'query'),
              sort: optionalString(params.sort, 'sort'),
              ...pagination,
            }
          case 'bitbucket_get_pull_request':
          case 'bitbucket_decline_pull_request':
          case 'bitbucket_approve_pull_request':
          case 'bitbucket_request_pull_request_changes':
            return { ...common, prId: optionalInteger(params.prId, 'prId') }
          case 'bitbucket_create_pull_request':
            return {
              ...common,
              title: optionalString(params.title, 'title'),
              sourceBranch: optionalString(params.sourceBranch, 'sourceBranch'),
              destinationBranch: optionalString(params.destinationBranch, 'destinationBranch'),
              description: optionalText(params.description, 'description'),
              reviewerUuids: stringList(params.reviewerAccountIds, 'reviewerAccountIds'),
              closeSourceBranch: optionalBoolean(
                params.createCloseSourceBranch,
                'createCloseSourceBranch'
              ),
              draft: optionalBoolean(params.draft, 'draft'),
            }
          case 'bitbucket_merge_pull_request':
            return {
              ...common,
              prId: optionalInteger(params.prId, 'prId'),
              mergeStrategy: optionalString(params.mergeStrategy, 'mergeStrategy'),
              message: optionalText(params.message, 'message'),
              closeSourceBranch: optionalBoolean(
                params.mergeCloseSourceBranch,
                'mergeCloseSourceBranch'
              ),
            }
          case 'bitbucket_get_pull_request_merge_task_status':
            return {
              ...common,
              prId: optionalInteger(params.prId, 'prId'),
              taskId: optionalString(params.taskId, 'taskId'),
            }
          case 'bitbucket_get_pull_request_diff':
            return {
              ...common,
              prId: optionalInteger(params.prId, 'prId'),
              path: optionalText(params.path, 'path'),
              maxCharacters: optionalInteger(params.maxCharacters, 'maxCharacters'),
            }
          case 'bitbucket_get_pull_request_diffstat':
            return { ...common, prId: optionalInteger(params.prId, 'prId'), ...pagination }
          case 'bitbucket_list_pull_request_comments':
          case 'bitbucket_list_pull_request_commit_statuses':
            return {
              ...common,
              prId: optionalInteger(params.prId, 'prId'),
              q: optionalString(params.query, 'query'),
              sort: optionalString(params.sort, 'sort'),
              ...pagination,
            }
          case 'bitbucket_create_pull_request_comment':
            return {
              ...common,
              prId: optionalInteger(params.prId, 'prId'),
              content: optionalText(params.content, 'content'),
              parentId: optionalInteger(params.parentId, 'parentId'),
            }
          case 'bitbucket_get_pipeline':
          case 'bitbucket_stop_pipeline':
            return { ...common, pipelineUuid: optionalString(params.pipelineUuid, 'pipelineUuid') }
          case 'bitbucket_trigger_pipeline':
            return {
              ...common,
              refType: 'branch',
              refName: optionalString(params.targetRef, 'targetRef'),
              commitHash: optionalString(params.targetCommitHash, 'targetCommitHash'),
            }
          case 'bitbucket_list_pipeline_steps':
            return {
              ...common,
              pipelineUuid: optionalString(params.pipelineUuid, 'pipelineUuid'),
              ...pagination,
            }
          case 'bitbucket_get_pipeline_step_log':
            return {
              ...common,
              pipelineUuid: optionalString(params.pipelineUuid, 'pipelineUuid'),
              stepUuid: optionalString(params.stepUuid, 'stepUuid'),
              maxCharacters: optionalInteger(params.maxCharacters, 'maxCharacters'),
            }
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Bitbucket operation to perform' },
    oauthCredential: { type: 'string', description: 'Bitbucket OAuth credential' },
    workspaceSlug: { type: 'string', description: 'Bitbucket workspace slug' },
    repoSlug: { type: 'string', description: 'Bitbucket repository slug' },
    pageLen: { type: 'number', description: 'Requested page size' },
    nextUrl: { type: 'string', description: 'Validated next-page URL' },
    query: { type: 'string', description: 'Bitbucket filtering expression' },
    sort: { type: 'string', description: 'Bitbucket sorting expression' },
    administrator: { type: 'boolean', description: 'Workspace administrator filter' },
    role: { type: 'string', description: 'Repository role filter' },
    branchName: { type: 'string', description: 'Branch name' },
    target: { type: 'string', description: 'Full commit hash or existing ref for the new branch' },
    revision: { type: 'string', description: 'Full commit SHA' },
    path: { type: 'string', description: 'Repository-relative file or directory path' },
    state: { type: 'string', description: 'Pull request state filter' },
    prId: { type: 'number', description: 'Pull request ID' },
    title: { type: 'string', description: 'Pull request title' },
    sourceBranch: { type: 'string', description: 'Pull request source branch' },
    destinationBranch: { type: 'string', description: 'Pull request destination branch' },
    description: { type: 'string', description: 'Pull request description' },
    reviewerAccountIds: {
      type: 'string',
      description: 'Comma-separated reviewer Bitbucket user UUIDs',
    },
    createCloseSourceBranch: {
      type: 'boolean',
      description: 'Whether to close the source branch after the pull request merges',
    },
    mergeCloseSourceBranch: {
      type: 'boolean',
      description: 'Whether to close the source branch as part of this merge',
    },
    draft: { type: 'boolean', description: 'Whether to create a draft pull request' },
    mergeStrategy: { type: 'string', description: 'Pull request merge strategy' },
    message: { type: 'string', description: 'Merge commit message' },
    taskId: { type: 'string', description: 'Asynchronous merge task ID' },
    content: { type: 'string', description: 'Pull request comment content' },
    parentId: { type: 'number', description: 'Parent pull request comment ID' },
    pipelineRefType: { type: 'string', description: 'Pipeline list reference type filter' },
    pipelineRefName: { type: 'string', description: 'Pipeline list reference name filter' },
    pipelineCommitHash: { type: 'string', description: 'Pipeline list commit SHA filter' },
    pipelineSelectorType: { type: 'string', description: 'Pipeline selector type filter' },
    pipelineSelectorPattern: { type: 'string', description: 'Pipeline selector pattern filter' },
    pipelineTriggerType: { type: 'string', description: 'Pipeline trigger type filter' },
    pipelineStatus: { type: 'string', description: 'Pipeline status filter' },
    pipelineUuid: { type: 'string', description: 'Pipeline UUID' },
    targetRef: { type: 'string', description: 'Pipeline branch target' },
    targetCommitHash: { type: 'string', description: 'Optional pipeline target commit SHA' },
    stepUuid: { type: 'string', description: 'Pipeline step UUID' },
    maxCharacters: { type: 'number', description: 'Maximum bounded raw content length' },
  },
  outputs: {
    items: { type: 'array', description: 'Items returned by a list operation' },
    page: { type: 'json', description: 'Bitbucket pagination metadata' },
    repository: { type: 'json', description: 'Repository details' },
    branch: { type: 'json', description: 'Branch details' },
    deleted: { type: 'boolean', description: 'Whether a branch was deleted' },
    commit: { type: 'json', description: 'Commit details' },
    file: { type: 'json', description: 'File metadata' },
    content: { type: 'string', description: 'Bounded file content' },
    binary: { type: 'boolean', description: 'Whether file content is binary' },
    truncated: { type: 'boolean', description: 'Whether raw content was truncated' },
    decodingLossy: { type: 'boolean', description: 'Whether invalid UTF-8 bytes were replaced' },
    returnedBytes: { type: 'number', description: 'Provider bytes read for raw content' },
    fullBytes: { type: 'number', description: 'Full raw-content byte size when reported' },
    contentType: { type: 'string', description: 'Raw file response content type' },
    pullRequest: { type: 'json', description: 'Pull request details' },
    status: { type: 'string', description: 'Merge request status' },
    taskId: { type: 'string', description: 'Asynchronous merge task ID' },
    taskUrl: { type: 'string', description: 'Asynchronous merge task URL' },
    taskStatus: { type: 'string', description: 'Asynchronous merge task status' },
    selfUrl: { type: 'string', description: 'Merge task API URL' },
    mergeResult: { type: 'json', description: 'Completed asynchronous merge result' },
    participant: { type: 'json', description: 'Pull request review participant' },
    diff: { type: 'string', description: 'Bounded unified diff text' },
    comment: { type: 'json', description: 'Pull request comment details' },
    pipeline: { type: 'json', description: 'Pipeline details' },
    stopped: { type: 'boolean', description: 'Whether a pipeline stop request succeeded' },
    log: { type: 'string', description: 'Bounded pipeline step log tail' },
    totalBytes: { type: 'number', description: 'Full pipeline log byte size when reported' },
  },
  triggers: {
    enabled: true,
    available: [
      'bitbucket_push',
      'bitbucket_repository_forked',
      'bitbucket_repository_updated',
      'bitbucket_commit_comment_created',
      'bitbucket_build_status_created',
      'bitbucket_build_status_updated',
      'bitbucket_pull_request_created',
      'bitbucket_pull_request_updated',
      'bitbucket_pull_request_approved',
      'bitbucket_pull_request_approval_removed',
      'bitbucket_pull_request_changes_requested',
      'bitbucket_pull_request_changes_request_removed',
      'bitbucket_pull_request_merged',
      'bitbucket_pull_request_declined',
      'bitbucket_pull_request_comment_created',
      'bitbucket_pull_request_comment_updated',
      'bitbucket_pull_request_comment_deleted',
      'bitbucket_pull_request_comment_resolved',
      'bitbucket_pull_request_comment_reopened',
    ],
  },
}

export const BitbucketBlockMeta = {
  tags: ['version-control', 'ci-cd', 'automation'],
  url: 'https://bitbucket.org',
  templates: [
    {
      icon: BitbucketIcon,
      title: 'Bitbucket pull request review assistant',
      prompt:
        'Build a workflow that reads a Bitbucket pull request, discovers its changed files with diffstat, reviews each bounded file diff against our engineering standards, and posts one concise general pull request comment with findings and suggested fixes.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'automation'],
    },
    {
      icon: BitbucketIcon,
      title: 'Bitbucket pipeline failure diagnosis',
      prompt:
        'Create a workflow that inspects a failed Bitbucket pipeline, lists its steps, reads the bounded tail of each failed step log, identifies the likely root cause, and sends an actionable diagnosis to Slack.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['ci-cd', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: BitbucketIcon,
      title: 'Bitbucket merge readiness report',
      prompt:
        'Build a workflow that reads an open Bitbucket pull request, its reviewers, commit statuses, and changed-file summary, then reports approvals, failing checks, risky changes, and the remaining review work without merging it.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'reporting'],
    },
    {
      icon: BitbucketIcon,
      title: 'Bitbucket release notes generator',
      prompt:
        'Create a workflow that lists recent Bitbucket commits in a repository, reads ambiguous commit details, groups the changes by area, and drafts clear release notes for review.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'content'],
    },
    {
      icon: BitbucketIcon,
      title: 'Bitbucket stale pull request review',
      prompt:
        'Build a scheduled workflow that lists open Bitbucket pull requests, identifies stale work from its update timestamps and review state, summarizes the next action for each, and posts a weekly reminder in Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['team', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: BitbucketIcon,
      title: 'Bitbucket engineering activity digest',
      prompt:
        'Create a scheduled workflow that summarizes recent Bitbucket commits, pull request activity, and pipeline results across a repository into a concise engineering digest delivered by email.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['reporting', 'team'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: BitbucketIcon,
      title: 'Bitbucket and Jira delivery automation',
      prompt:
        'Build a workflow that reads a Bitbucket pull request and its head commit, extracts Jira issue keys from the title, description, source branch, and commit message, summarizes delivery and pipeline status, and adds the update to the matching Jira issue.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['project-management', 'automation'],
      alsoIntegrations: ['jira'],
    },
  ],
  skills: [
    {
      name: 'review-bitbucket-pull-request',
      description:
        'Review a Bitbucket pull request file by file and produce a concise, evidence-backed general comment.',
      content:
        '# Review a Bitbucket Pull Request\n\n## Steps\n1. Read the pull request and use diffstat to discover changed files.\n2. Fetch each file-scoped diff separately and respect truncation metadata.\n3. Evaluate correctness, security, tests, and maintainability using only evidence in the diff.\n4. Group duplicate findings and distinguish blockers from suggestions.\n5. Post one general pull request comment only when asked.\n\n## Output\nSummarize the risk, list findings with file paths, and state whether human review is still needed.',
    },
    {
      name: 'diagnose-bitbucket-pipeline',
      description:
        'Trace a failed Bitbucket pipeline to the failing step and explain the most likely root cause.',
      content:
        '# Diagnose a Bitbucket Pipeline\n\n## Steps\n1. Read the pipeline and list all steps.\n2. Focus on failed or stopped steps.\n3. Read bounded log tails and account for partial or truncated output.\n4. Identify the first causal error rather than downstream noise.\n5. Recommend the smallest verifiable fix.\n\n## Output\nReport the failed step, evidence from the log, likely cause, and next diagnostic or fix.',
    },
    {
      name: 'assess-bitbucket-merge-readiness',
      description:
        'Assess approvals, commit statuses, and changed-file risk before a Bitbucket merge.',
      content:
        '# Assess Bitbucket Merge Readiness\n\n## Steps\n1. Read the pull request and current participants.\n2. List commit statuses and changed files.\n3. Identify missing approvals, failed or pending checks, and risky changes.\n4. Do not infer that a status is required or claim conflict status when the API data does not say so.\n5. Never merge unless the user explicitly requests it.\n\n## Output\nReturn a ready, blocked, or needs-review assessment with each observed blocker and its evidence.',
    },
    {
      name: 'draft-bitbucket-release-notes',
      description:
        'Turn Bitbucket commit history into audience-friendly release notes without inventing changes.',
      content:
        '# Draft Bitbucket Release Notes\n\n## Steps\n1. List recent commits in the requested repository.\n2. Read commit details where summaries are ambiguous.\n3. Group changes into features, fixes, performance, and maintenance.\n4. Preserve contributor attribution and relevant links when present.\n5. Flag unclear commits rather than guessing their user impact.\n\n## Output\nProduce a short release summary followed by categorized bullets and known upgrade risks.',
    },
    {
      name: 'triage-stale-bitbucket-pull-requests',
      description:
        'Identify stale Bitbucket pull requests and recommend the next owner and action for each.',
      content:
        '# Triage Stale Bitbucket Pull Requests\n\n## Steps\n1. List open pull requests and read candidates that have not changed recently.\n2. Check reviewers, comments, changed files, and commit statuses.\n3. Distinguish waiting-for-author, waiting-for-review, failing-CI, and obsolete work.\n4. Recommend a next action and responsible participant.\n5. Decline or comment only when explicitly requested.\n\n## Output\nReturn a prioritized table of stale pull requests, age, blocker, owner, and next action.',
    },
    {
      name: 'summarize-bitbucket-activity',
      description:
        'Summarize repository commits, pull requests, and pipeline activity for an engineering update.',
      content:
        '# Summarize Bitbucket Activity\n\n## Steps\n1. Gather recent commits, pull requests, and pipelines for the repository.\n2. Deduplicate activity that represents the same change.\n3. Highlight merged work, active reviews, failures, and delivery risks.\n4. Link to source records when URLs are available.\n\n## Output\nProvide a concise digest with shipped, in review, CI health, and attention-needed sections.',
    },
    {
      name: 'sync-bitbucket-delivery-to-jira',
      description:
        'Connect Bitbucket pull request and pipeline evidence to the matching Jira delivery record.',
      content:
        '# Sync Bitbucket Delivery to Jira\n\n## Steps\n1. Read the pull request, source branch, head commit, and pipeline status.\n2. Extract Jira keys conservatively and verify the intended Jira issue.\n3. Summarize implementation, review state, and CI status.\n4. Add a Jira update only when a unique issue match is established.\n5. Never transition or close the Jira issue unless explicitly requested.\n\n## Output\nReport the matched issue, linked pull request, delivery state, and any ambiguity that blocked an update.',
    },
  ],
} as const satisfies BlockMeta
