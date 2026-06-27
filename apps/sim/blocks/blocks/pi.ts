import { getEnv, isTruthy } from '@/lib/core/config/env'
import { PiBlockDisplay } from '@/blocks/blocks/pi.display'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
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
const LOCAL: { field: 'mode'; value: 'local' } = { field: 'mode', value: 'local' }
const MEMORY_TYPES = ['conversation', 'sliding_window', 'sliding_window_tokens']

export const PiBlock: BlockConfig<PiResponse> = {
  ...PiBlockDisplay,
  authMode: AuthMode.ApiKey,
  bestPractices: `
  - Use Cloud mode for hands-off changes against a GitHub repo where a reviewable PR is the deliverable.
  - Use Local mode to edit a repo on your own machine; expose the machine on a public hostname/tunnel so Sim can reach it over SSH.
  - Cloud mode requires your own provider API key (BYOK); the model key is never injected as a hosted key into the sandbox.
  `,
  subBlocks: [
    {
      id: 'mode',
      title: 'Mode',
      type: 'dropdown',
      // Cloud mode runs in an E2B sandbox; only offer it where E2B is enabled.
      value: () => (isTruthy(getEnv('NEXT_PUBLIC_E2B_ENABLED')) ? 'cloud' : 'local'),
      options: () => {
        const options = [
          {
            label: 'Local',
            id: 'local',
            description: 'Edits files on your own machine over SSH',
          },
        ]
        if (isTruthy(getEnv('NEXT_PUBLIC_E2B_ENABLED'))) {
          options.unshift({
            label: 'Cloud',
            id: 'cloud',
            description: 'Runs in an isolated sandbox, clones your repo, and opens a PR',
          })
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
      id: 'owner',
      title: 'Repository Owner',
      type: 'short-input',
      placeholder: 'e.g., your-org',
      required: true,
      condition: CLOUD,
    },
    {
      id: 'repo',
      title: 'Repository Name',
      type: 'short-input',
      placeholder: 'e.g., my-repo',
      required: true,
      condition: CLOUD,
    },
    {
      id: 'githubToken',
      title: 'GitHub Token',
      type: 'short-input',
      password: true,
      paramVisibility: 'user-only',
      placeholder: 'GitHub personal access token (repo scope)',
      tooltip: 'Personal access token with repo scope, used to clone, push, and open the PR.',
      required: true,
      condition: CLOUD,
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
      condition: CLOUD,
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
    },
    {
      id: 'conversationId',
      title: 'Conversation ID',
      type: 'short-input',
      placeholder: 'e.g., user-123, session-abc',
      mode: 'advanced',
      required: { field: 'memoryType', value: MEMORY_TYPES },
      condition: { field: 'memoryType', value: MEMORY_TYPES },
      dependsOn: ['memoryType'],
    },
    {
      id: 'slidingWindowSize',
      title: 'Sliding Window Size',
      type: 'short-input',
      placeholder: 'Enter number of messages (e.g., 10)...',
      mode: 'advanced',
      condition: { field: 'memoryType', value: ['sliding_window'] },
      dependsOn: ['memoryType'],
    },
    {
      id: 'slidingWindowTokens',
      title: 'Max Tokens',
      type: 'short-input',
      placeholder: 'Enter max tokens (e.g., 4000)...',
      mode: 'advanced',
      condition: { field: 'memoryType', value: ['sliding_window_tokens'] },
      dependsOn: ['memoryType'],
    },
  ],
  tools: {
    access: [],
  },
  inputs: {
    mode: { type: 'string', description: 'Execution mode: cloud or local' },
    task: { type: 'string', description: 'Instruction for the coding agent' },
    model: { type: 'string', description: 'AI model to use' },
    owner: { type: 'string', description: 'GitHub repository owner (cloud mode)' },
    repo: { type: 'string', description: 'GitHub repository name (cloud mode)' },
    githubToken: { type: 'string', description: 'GitHub token override (cloud mode)' },
    baseBranch: { type: 'string', description: 'Base branch for the PR (cloud mode)' },
    branchName: { type: 'string', description: 'Branch to create (cloud mode)' },
    draft: { type: 'boolean', description: 'Open the PR as a draft (cloud mode)' },
    prTitle: { type: 'string', description: 'Pull request title (cloud mode)' },
    prBody: { type: 'string', description: 'Pull request body (cloud mode)' },
    host: { type: 'string', description: 'SSH host (local mode)' },
    port: { type: 'number', description: 'SSH port (local mode)' },
    username: { type: 'string', description: 'SSH username (local mode)' },
    authMethod: { type: 'string', description: 'SSH authentication method (local mode)' },
    password: { type: 'string', description: 'SSH password (local mode)' },
    privateKey: { type: 'string', description: 'SSH private key (local mode)' },
    passphrase: { type: 'string', description: 'SSH key passphrase (local mode)' },
    repoPath: { type: 'string', description: 'Repository path on the target (local mode)' },
    tools: { type: 'json', description: 'Sim tools exposed to the agent (local mode)' },
    skills: { type: 'json', description: 'Selected skills configuration' },
    thinkingLevel: { type: 'string', description: 'Thinking level for the model' },
    memoryType: { type: 'string', description: 'Memory type for multi-turn conversations' },
    conversationId: { type: 'string', description: 'Conversation ID for memory' },
    slidingWindowSize: { type: 'string', description: 'Number of messages for sliding window' },
    slidingWindowTokens: { type: 'string', description: 'Max tokens for token-based window' },
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
    tokens: { type: 'json', description: 'Token usage statistics' },
    cost: { type: 'json', description: 'Cost of the run' },
    providerTiming: { type: 'json', description: 'Provider timing information' },
  },
}
