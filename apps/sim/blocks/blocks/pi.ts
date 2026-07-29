import { PiIcon } from '@/components/icons'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import {
  getPiModelOptions,
  getProviderCredentialSubBlocks,
  PROVIDER_CREDENTIAL_INPUTS,
} from '@/blocks/utils'
import type { ToolResponse } from '@/tools/types'

interface PiResponse extends ToolResponse {
  output: {
    content: string
    model: string
    changedFiles?: string[]
    diff?: string
    prUrl?: string
    branch?: string
    reviewUrl?: string
    commentsPosted?: number
    rounds?: number
    threadsClean?: boolean
    checksGreen?: boolean
    threadsResolved?: number
    commitsPushed?: number
    stopReason?: string
    tokens?: {
      input?: number
      output?: number
      total?: number
    }
    cost?: {
      input?: number
      output?: number
      total?: number
    }
    providerTiming?: {
      startTime?: string
      endTime?: string
      duration?: number
    }
  }
}

const CLOUD: { field: 'mode'; value: 'cloud' } = { field: 'mode', value: 'cloud' }
const CLOUD_REVIEW: { field: 'mode'; value: 'cloud_review' } = {
  field: 'mode',
  value: 'cloud_review',
}
const CLOUD_ANY: { field: 'mode'; value: Array<'cloud' | 'cloud_review'> } = {
  field: 'mode',
  value: ['cloud', 'cloud_review'],
}
const CLOUD_WITH_BABYSIT: {
  field: 'mode'
  value: 'cloud'
  and: { field: 'babysitMode'; value: true }
} = {
  field: 'mode',
  value: 'cloud',
  and: { field: 'babysitMode', value: true },
}
const CLOUD_WITHOUT_BABYSIT: {
  field: 'mode'
  value: 'cloud'
  and: { field: 'babysitMode'; value: true; not: true }
} = {
  field: 'mode',
  value: 'cloud',
  and: { field: 'babysitMode', value: true, not: true },
}
const LOCAL: { field: 'mode'; value: 'local' } = { field: 'mode', value: 'local' }
const AUTHORING_MODES: { field: 'mode'; value: Array<'cloud' | 'local'> } = {
  field: 'mode',
  value: ['cloud', 'local'],
}
const MEMORY_TYPES = ['conversation', 'sliding_window', 'sliding_window_tokens']

const SEARCH_PROVIDER_OPTIONS = [
  { label: 'None', id: 'none' },
  { label: 'Exa', id: 'exa' },
  { label: 'Serper', id: 'serper' },
  { label: 'Parallel AI', id: 'parallel' },
  { label: 'Firecrawl', id: 'firecrawl' },
]

/**
 * Mirrors `getApiKeyCondition()` for the model key: the search key's visibility is computed rather
 * than declarative. The never-matching sentinel is how `buildModelVisibilityCondition` hides the
 * model key when nothing is selected, and it is what keeps the field hidden on a block saved before
 * this field existed — such a block has no stored `searchProvider`, and the declarative negative
 * form would show the field, because a scalar `not` condition evaluates `undefined !== 'none'` as
 * true.
 */
function getSearchApiKeyCondition() {
  return (values?: Record<string, unknown>) => {
    const provider = typeof values?.searchProvider === 'string' ? values.searchProvider : ''
    if (!provider || provider === 'none') {
      return { field: 'searchProvider', value: '__no_search_provider__' }
    }
    return { field: 'searchProvider', value: provider }
  }
}

export const PiBlock: BlockConfig<PiResponse> = {
  type: 'pi',
  name: 'Pi Coding Agent',
  description: 'Run an autonomous coding agent on a repo',
  authMode: AuthMode.ApiKey,
  longDescription:
    'The Pi Coding Agent runs the Pi harness against a real repository. Create PR spins up an isolated sandbox, clones a GitHub repo, edits with native shell + git, and opens a pull request; Babysit Mode then keeps that pull request under watch, fixing trusted bot review threads and failing required checks in bounded rounds. Review Code checks out a pinned PR snapshot with read-only tools and posts a structured review with optional inline comments. Local Dev edits files on your own machine over SSH. Create PR and Local Dev can reuse skills and multi-turn memory; Review Code runs without either because PR contents are untrusted. Any mode can optionally get one web_search tool backed by your own Exa, Serper, Parallel AI, or Firecrawl key; the agent writes its own queries, so repository content may reach the provider, and results are untrusted third-party data.',
  bestPractices: `
  - Use Create PR for hands-off changes against a GitHub repo where a reviewable PR is the deliverable.
  - Enable Babysit Mode on Create PR when trusted review bots and required checks should be monitored and fixed in bounded rounds.
  - Use Review Code to analyze an existing PR and leave summary + inline review comments.
  - Use Local Dev to edit a repo on your own machine; expose the machine on a public hostname/tunnel so Sim can reach it over SSH.
  - Create PR requires your own provider API key because the model runs in the sandbox. Review Code keeps the model key in Sim and can use either BYOK or a hosted key.
  - Internet Search is off by default and always needs your own key for the selected provider, entered on the block. There is no workspace BYOK fallback and no hosted key. Leave it on None unless the task genuinely needs external information.
  `,
  category: 'blocks',
  integrationType: IntegrationType.AI,
  bgColor: '#000000',
  icon: PiIcon,
  subBlocks: [
    {
      id: 'mode',
      title: 'Mode',
      type: 'dropdown',
      /** Create PR and Review Code require E2B and stay hidden when it is disabled. */
      value: () => (isTruthy(getEnv('NEXT_PUBLIC_E2B_ENABLED')) ? 'cloud' : 'local'),
      options: () => {
        const options = [
          {
            label: 'Local Dev',
            id: 'local',
            description: 'Edits files on your own machine over SSH',
          },
        ]
        if (isTruthy(getEnv('NEXT_PUBLIC_E2B_ENABLED'))) {
          options.unshift(
            {
              label: 'Create PR',
              id: 'cloud',
              description: 'Runs in an isolated sandbox, clones your repo, and opens a PR',
            },
            {
              label: 'Review Code',
              id: 'cloud_review',
              description: 'Reviews an existing PR and posts GitHub review comments',
            }
          )
        }
        return options
      },
    },
    {
      id: 'task',
      title: 'Task',
      type: 'long-input',
      placeholder: 'Describe what the coding agent should do...',
      required: true,
    },
    {
      id: 'model',
      title: 'Model',
      type: 'combobox',
      placeholder: 'Type or select a model...',
      required: true,
      defaultValue: 'claude-sonnet-4-6',
      options: getPiModelOptions,
      commandSearchable: true,
    },

    ...getProviderCredentialSubBlocks(),

    {
      id: 'searchProvider',
      title: 'Internet Search',
      type: 'dropdown',
      defaultValue: 'none',
      options: SEARCH_PROVIDER_OPTIONS,
      tooltip:
        'Gives the agent a single web_search tool backed by the selected provider. Search always uses your own key for that provider, never a Sim-hosted one, because Create PR places the key inside the coding sandbox.',
    },
    {
      id: 'searchApiKey',
      title: 'Search API Key',
      type: 'short-input',
      password: true,
      paramVisibility: 'user-only',
      connectionDroppable: false,
      placeholder: 'Your key for the selected provider',
      // The only source: search has no workspace BYOK fallback and never uses a Sim-hosted key, and
      // unlike the model key this field is shown on every deployment. Marking it required is what
      // surfaces that in the editor rather than at the start of a run.
      required: true,
      // Scoped to the editor on purpose: the clear-on-switch is driven by `dependsOn` through the
      // collaborative setter, so a workflow imported, forked, or updated through the API keeps
      // whatever key was stored. Promising an unconditional clear would be wrong in exactly the
      // case where sending the previous provider's key to a new vendor actually matters.
      tooltip:
        'Key for the selected search provider. Changing the provider in the editor clears this field, so re-enter the key for the one you picked. Imported or API-updated workflows keep the saved key — check it belongs to the selected provider.',
      condition: getSearchApiKeyCondition(),
      dependsOn: ['searchProvider'],
    },

    {
      id: 'owner',
      title: 'Repository Owner',
      type: 'short-input',
      placeholder: 'e.g., your-org',
      required: true,
      condition: CLOUD_ANY,
    },
    {
      id: 'repo',
      title: 'Repository Name',
      type: 'short-input',
      placeholder: 'e.g., my-repo',
      required: true,
      condition: CLOUD_ANY,
    },
    {
      id: 'githubToken',
      title: 'GitHub Token',
      type: 'short-input',
      password: true,
      paramVisibility: 'user-only',
      placeholder: 'GitHub personal access token',
      tooltip:
        'Personal access token used for GitHub access. Create PR needs clone/push/PR permissions; with Babysit Mode it also needs check/Actions reads, thread writes, and issue comments. Review Code needs clone + review permissions.',
      required: true,
      condition: CLOUD_ANY,
    },
    {
      id: 'baseBranch',
      title: 'Base Branch',
      type: 'short-input',
      placeholder: 'e.g., main (defaults to the repository default branch)',
      tooltip: 'The branch the pull request is opened against; the repo is cloned from it too.',
      condition: CLOUD,
    },
    {
      id: 'babysitMode',
      title: 'Babysit Mode',
      type: 'switch',
      defaultValue: false,
      description:
        'Create the PR ready for review, request the configured bot reviews, and fix trusted feedback and required checks in bounded rounds.',
      condition: CLOUD,
    },
    {
      id: 'reviewMentions',
      title: 'Reviewer Mentions',
      type: 'short-input',
      defaultValue: '',
      placeholder: '@greptile, @cursor review',
      tooltip:
        'Required comma-separated issue comments. Each is posted after PR creation and again after every pushed Babysit fix.',
      hideDividerBefore: true,
      required: CLOUD_WITH_BABYSIT,
      condition: CLOUD_WITH_BABYSIT,
    },
    {
      id: 'branchName',
      title: 'Branch Name',
      type: 'short-input',
      placeholder: 'Auto-generated when blank',
      mode: 'advanced',
      condition: CLOUD,
    },
    {
      id: 'draft',
      title: 'Open as Draft PR',
      type: 'switch',
      defaultValue: true,
      mode: 'advanced',
      condition: CLOUD_WITHOUT_BABYSIT,
    },
    {
      id: 'prTitle',
      title: 'PR Title',
      type: 'short-input',
      placeholder: 'Generated from the run when blank',
      mode: 'advanced',
      condition: CLOUD,
    },
    {
      id: 'prBody',
      title: 'PR Body',
      type: 'long-input',
      placeholder: 'Generated from the run when blank',
      mode: 'advanced',
      condition: CLOUD,
    },
    {
      id: 'pullNumber',
      title: 'Pull Request Number',
      type: 'short-input',
      placeholder: 'e.g., 42',
      required: true,
      condition: CLOUD_REVIEW,
    },
    {
      id: 'reviewEvent',
      title: 'Review Outcome',
      type: 'dropdown',
      defaultValue: 'COMMENT',
      options: [
        { label: 'Comment', id: 'COMMENT' },
        { label: 'Request changes', id: 'REQUEST_CHANGES' },
      ],
      tooltip:
        'How GitHub records the submitted review. Comment is neutral; Request changes marks the pull request as changes requested.',
      condition: CLOUD_REVIEW,
    },
    {
      id: 'maxRounds',
      title: 'Maximum Rounds',
      type: 'short-input',
      defaultValue: '3',
      placeholder: '3',
      tooltip: 'Maximum number of agent fixing rounds, from 1 to 10.',
      mode: 'advanced',
      condition: CLOUD_WITH_BABYSIT,
    },

    {
      id: 'host',
      title: 'Host',
      type: 'short-input',
      placeholder: 'Public hostname from a TCP tunnel (e.g., 2.tcp.ngrok.io)',
      tooltip:
        'The machine must be reachable on a public hostname — localhost/LAN addresses are blocked. Use a raw TCP tunnel such as `ngrok tcp 22`.',
      required: true,
      condition: LOCAL,
    },
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      placeholder: 'ubuntu, root, or deploy',
      required: true,
      condition: LOCAL,
    },
    {
      id: 'authMethod',
      title: 'Authentication Method',
      type: 'dropdown',
      defaultValue: 'password',
      options: [
        { label: 'Password', id: 'password' },
        { label: 'Private Key', id: 'privateKey' },
      ],
      condition: LOCAL,
    },
    {
      id: 'password',
      title: 'Password',
      type: 'short-input',
      password: true,
      paramVisibility: 'user-only',
      placeholder: 'Your SSH password',
      required: { field: 'mode', value: 'local', and: { field: 'authMethod', value: 'password' } },
      condition: { field: 'mode', value: 'local', and: { field: 'authMethod', value: 'password' } },
      dependsOn: ['authMethod'],
    },
    {
      id: 'privateKey',
      title: 'Private Key',
      type: 'code',
      paramVisibility: 'user-only',
      placeholder: '-----BEGIN OPENSSH PRIVATE KEY-----\n...',
      required: {
        field: 'mode',
        value: 'local',
        and: { field: 'authMethod', value: 'privateKey' },
      },
      condition: {
        field: 'mode',
        value: 'local',
        and: { field: 'authMethod', value: 'privateKey' },
      },
      dependsOn: ['authMethod'],
    },
    {
      id: 'repoPath',
      title: 'Repository Path',
      type: 'short-input',
      placeholder: '/home/user/my-repo',
      tooltip: 'Absolute path to the repository on the target machine.',
      required: true,
      condition: LOCAL,
    },
    {
      id: 'port',
      title: 'Port',
      type: 'short-input',
      placeholder: '22',
      defaultValue: '22',
      mode: 'advanced',
      condition: LOCAL,
    },
    {
      id: 'passphrase',
      title: 'Passphrase',
      type: 'short-input',
      password: true,
      paramVisibility: 'user-only',
      placeholder: 'Passphrase for encrypted key (optional)',
      mode: 'advanced',
      condition: {
        field: 'mode',
        value: 'local',
        and: { field: 'authMethod', value: 'privateKey' },
      },
      dependsOn: ['authMethod'],
    },
    {
      id: 'tools',
      title: 'Tools',
      type: 'tool-input',
      defaultValue: [],
      mode: 'advanced',
      condition: LOCAL,
      unsupportedToolTypes: ['mcp', 'custom-tool'],
    },

    {
      id: 'skills',
      title: 'Skills',
      type: 'skill-input',
      defaultValue: [],
      mode: 'advanced',
      condition: AUTHORING_MODES,
    },
    {
      id: 'thinkingLevel',
      title: 'Thinking Level',
      type: 'dropdown',
      defaultValue: 'medium',
      options: [
        { label: 'none', id: 'none' },
        { label: 'low', id: 'low' },
        { label: 'medium', id: 'medium' },
        { label: 'high', id: 'high' },
        { label: 'max', id: 'max' },
      ],
      tooltip:
        "Requested reasoning effort for Pi. Pi clamps it to the selected model's supported levels; models without reasoning run with thinking off. Higher levels usually increase latency and token cost.",
      mode: 'advanced',
    },
    {
      id: 'memoryType',
      title: 'Memory',
      type: 'dropdown',
      defaultValue: 'none',
      options: [
        { label: 'None', id: 'none' },
        { label: 'Conversation', id: 'conversation' },
        { label: 'Sliding window (messages)', id: 'sliding_window' },
        { label: 'Sliding window (tokens)', id: 'sliding_window_tokens' },
      ],
      mode: 'advanced',
      condition: AUTHORING_MODES,
    },
    {
      id: 'conversationId',
      title: 'Conversation ID',
      type: 'short-input',
      placeholder: 'e.g., user-123, session-abc',
      mode: 'advanced',
      required: {
        field: 'mode',
        value: ['cloud', 'local'],
        and: { field: 'memoryType', value: MEMORY_TYPES },
      },
      condition: {
        field: 'mode',
        value: ['cloud', 'local'],
        and: { field: 'memoryType', value: MEMORY_TYPES },
      },
      dependsOn: ['memoryType'],
    },
    {
      id: 'slidingWindowSize',
      title: 'Sliding Window Size',
      type: 'short-input',
      placeholder: 'Enter number of messages (e.g., 10)...',
      mode: 'advanced',
      condition: {
        field: 'mode',
        value: ['cloud', 'local'],
        and: { field: 'memoryType', value: ['sliding_window'] },
      },
      dependsOn: ['memoryType'],
    },
    {
      id: 'slidingWindowTokens',
      title: 'Max Tokens',
      type: 'short-input',
      placeholder: 'Enter max tokens (e.g., 4000)...',
      mode: 'advanced',
      condition: {
        field: 'mode',
        value: ['cloud', 'local'],
        and: { field: 'memoryType', value: ['sliding_window_tokens'] },
      },
      dependsOn: ['memoryType'],
    },
  ],
  tools: {
    access: [],
  },
  inputs: {
    mode: {
      type: 'string',
      description: 'Execution mode: Create PR, Review Code, or Local Dev',
    },
    task: { type: 'string', description: 'Instruction for the coding agent' },
    model: { type: 'string', description: 'AI model to use' },
    owner: { type: 'string', description: 'GitHub repository owner' },
    repo: { type: 'string', description: 'GitHub repository name' },
    githubToken: { type: 'string', description: 'GitHub token' },
    baseBranch: { type: 'string', description: 'Base branch for the PR (Create PR)' },
    branchName: { type: 'string', description: 'Branch to create (Create PR)' },
    draft: { type: 'boolean', description: 'Open the PR as a draft (Create PR)' },
    prTitle: { type: 'string', description: 'Pull request title (Create PR)' },
    prBody: { type: 'string', description: 'Pull request body (Create PR)' },
    babysitMode: {
      type: 'boolean',
      description: 'Create the PR and babysit trusted bot reviews and required checks',
    },
    pullNumber: { type: 'number', description: 'Pull request number (Review Code)' },
    maxRounds: {
      type: 'number',
      description: 'Maximum Create PR Babysit fixing rounds (1-10)',
    },
    reviewMentions: {
      type: 'string',
      description:
        'Required comma-separated bot review comments posted initially and after Babysit pushes',
    },
    reviewEvent: {
      type: 'string',
      description: 'GitHub review event: COMMENT or REQUEST_CHANGES',
    },
    host: { type: 'string', description: 'SSH host (Local Dev)' },
    port: { type: 'number', description: 'SSH port (Local Dev)' },
    username: { type: 'string', description: 'SSH username (Local Dev)' },
    authMethod: { type: 'string', description: 'SSH authentication method (Local Dev)' },
    password: { type: 'string', description: 'SSH password (Local Dev)' },
    privateKey: { type: 'string', description: 'SSH private key (Local Dev)' },
    passphrase: { type: 'string', description: 'SSH key passphrase (Local Dev)' },
    repoPath: { type: 'string', description: 'Repository path on the target (Local Dev)' },
    tools: { type: 'json', description: 'Sim tools exposed to the agent (Local Dev)' },
    skills: { type: 'json', description: 'Selected skills configuration' },
    thinkingLevel: { type: 'string', description: 'Thinking level for the model' },
    memoryType: { type: 'string', description: 'Memory type for multi-turn conversations' },
    conversationId: { type: 'string', description: 'Conversation ID for memory' },
    slidingWindowSize: { type: 'string', description: 'Number of messages for sliding window' },
    slidingWindowTokens: { type: 'string', description: 'Max tokens for token-based window' },
    searchProvider: {
      type: 'string',
      description: 'Web search provider for the agent: none, exa, serper, parallel, or firecrawl',
    },
    searchApiKey: { type: 'string', description: 'API key for the selected search provider' },
    ...PROVIDER_CREDENTIAL_INPUTS,
  },
  outputs: {
    content: { type: 'string', description: 'Final agent message / run summary' },
    model: { type: 'string', description: 'Model used for the run' },
    changedFiles: { type: 'json', description: 'Files changed by the agent' },
    diff: { type: 'string', description: 'Unified diff of the changes' },
    prUrl: {
      type: 'string',
      description: 'URL of the opened pull request',
      condition: CLOUD,
    },
    branch: {
      type: 'string',
      description: 'Branch pushed with the changes',
      condition: CLOUD,
    },
    reviewUrl: {
      type: 'string',
      description: 'URL of the submitted GitHub review',
      condition: CLOUD_REVIEW,
    },
    commentsPosted: {
      type: 'number',
      description: 'Number of inline review comments posted',
      condition: CLOUD_REVIEW,
    },
    rounds: {
      type: 'number',
      description: 'Babysit fixing rounds consumed',
      condition: CLOUD_WITH_BABYSIT,
    },
    threadsClean: {
      type: 'boolean',
      description: 'Whether all actionable review threads are resolved',
      condition: CLOUD_WITH_BABYSIT,
    },
    checksGreen: {
      type: 'boolean',
      description: 'Whether required checks are green with none pending',
      condition: CLOUD_WITH_BABYSIT,
    },
    threadsResolved: {
      type: 'number',
      description: 'Review threads resolved by Babysit',
      condition: CLOUD_WITH_BABYSIT,
    },
    commitsPushed: {
      type: 'number',
      description: 'Commits pushed by Babysit',
      condition: CLOUD_WITH_BABYSIT,
    },
    stopReason: {
      type: 'string',
      description: 'Why the Babysit run stopped',
      condition: CLOUD_WITH_BABYSIT,
    },
    tokens: { type: 'json', description: 'Token usage statistics' },
    cost: { type: 'json', description: 'Cost of the run' },
    providerTiming: { type: 'json', description: 'Provider timing information' },
  },
}
