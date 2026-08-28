import { OpenAIIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { CODEX_MODELS, CODEX_REASONING_EFFORTS } from '@/providers/codex'
import type { ToolResponse } from '@/tools/types'

interface CodexResponse extends ToolResponse {
  output: {
    content: string
    model: string
    runStatus: 'completed'
    agentId: string
    sessionReused: boolean
    turnNumber: number
    threadId?: string
    changedFiles?: string[]
    diff?: string
    prUrl?: string
    branch?: string
    commands?: Array<{
      id: string
      name: string
      isError: boolean
      summary?: string
      output?: string
    }>
    tokens?: {
      input?: number
      cacheRead?: number
      cacheWrite?: number
      output?: number
      reasoning?: number
      total?: number
    }
    cost?: { input?: number; output?: number; total?: number }
    providerTiming?: { startTime?: string; endTime?: string; duration?: number }
  }
}

export const CodexBlock: BlockConfig<CodexResponse> = {
  type: 'codex',
  name: 'Codex Coding Agent',
  description: 'Run reusable OpenAI Codex agents across workflow steps',
  longDescription:
    'The Codex Coding Agent runs the pinned OpenAI Codex CLI in an isolated E2B or Daytona sandbox. The same block reuses its agent, repository, and native Codex thread across loop rounds; multiple workflow steps can select the same Agent to share that context without managing IDs. Different Agents create isolated instances. Plan explores the retained checkout without pushing. Create PR keeps editing and updating one branch and pull request across turns. Instances live for one uninterrupted workflow execution, use private CODEX_HOME directories, ignore user configuration and execpolicy rules, never ask for approval, and require your own OpenAI API key or stored OpenAI BYOK key.',
  bestPractices: `
  - Repeated rounds of the same block automatically continue the same Codex thread.
  - Select the same Agent on multiple Codex blocks when they should share context and a checkout; choose New agent for independent work.
  - Configure mode, model, repository, base branch, and shell network once on the Agent. Workflow and Workspace defaults are inherited field by field.
  - Use the step-level Reasoning Effort override only when one task needs a different budget; leave it blank to inherit.
  - Use Plan for a multi-step investigation without changing GitHub, or Create PR to keep updating one reviewable branch and pull request.
  - Leave Agent Shell Network off unless dependency installation or external documentation is essential.
  - Codex requires your own OpenAI API key because the model client runs inside the isolated sandbox.
  `,
  authMode: AuthMode.ApiKey,
  category: 'blocks',
  integrationType: IntegrationType.AI,
  bgColor: '#000000',
  icon: OpenAIIcon,
  canvasPresentation: {
    defaultTitle: 'Codex',
    sentences: {
      default: [{ text: 'Run', field: 'task', core: true }],
    },
  },
  subBlocks: [
    {
      id: 'mode',
      title: 'Mode',
      type: 'dropdown',
      hidden: true,
      options: [
        {
          label: 'Plan',
          id: 'cloud_plan',
          description: 'Explores a disposable checkout and returns an implementation plan',
        },
        {
          label: 'Create PR',
          id: 'cloud',
          description: 'Edits in an isolated sandbox and opens a new pull request',
        },
      ],
    },
    {
      id: 'task',
      title: 'Task',
      type: 'long-input',
      placeholder: 'Describe what Codex should plan or implement...',
      required: true,
    },
    {
      id: 'agentId',
      title: 'Agent',
      type: 'agent-session-selector',
      // Hidden legacy fields are copied only to keep pre-overlay workflows compatible.
      agentSessionFields: ['mode', 'model', 'owner', 'repo', 'baseBranch', 'agentConfig'],
      hideFromPreview: true,
      tooltip:
        'Choose an existing agent to reuse its sandbox, checkout, Codex thread, branch, and pull request across workflow steps.',
    },
    {
      id: 'agentConfig',
      title: 'Agent Configuration Mirror',
      type: 'short-input',
      hidden: true,
      hideFromPreview: true,
      hideFromCopilot: true,
      paramVisibility: 'hidden',
    },
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      hidden: true,
      options: CODEX_MODELS.map((model) => ({ label: model, id: model })),
      tooltip: 'Models declared visible and API-capable by the pinned Codex CLI catalog.',
    },
    {
      id: 'apiKey',
      title: 'OpenAI API Key',
      type: 'short-input',
      password: true,
      paramVisibility: 'user-only',
      connectionDroppable: false,
      placeholder: 'Enter your OpenAI API key',
      tooltip:
        'Used only by the Codex process. You may instead configure an OpenAI key in Settings > BYOK.',
    },
    {
      id: 'owner',
      title: 'Repository Owner',
      type: 'short-input',
      hidden: true,
      placeholder: 'e.g., your-org',
    },
    {
      id: 'repo',
      title: 'Repository Name',
      type: 'short-input',
      hidden: true,
      placeholder: 'e.g., my-repo',
    },
    {
      id: 'githubToken',
      title: 'GitHub Token',
      type: 'short-input',
      password: true,
      paramVisibility: 'user-only',
      placeholder: 'GitHub personal access token',
      tooltip:
        'Plan needs clone access. Create PR also needs permission to push a branch and create a pull request. This token is never exposed to Codex.',
      required: true,
    },
    {
      id: 'baseBranch',
      title: 'Base Branch',
      type: 'short-input',
      hidden: true,
      placeholder: 'Defaults to the repository default branch',
    },
    {
      id: 'branchName',
      title: 'Branch Name',
      type: 'short-input',
      placeholder: 'Auto-generated when blank',
      mode: 'advanced',
    },
    {
      id: 'draft',
      title: 'Open as Draft PR',
      type: 'switch',
      defaultValue: true,
      mode: 'advanced',
    },
    {
      id: 'prTitle',
      title: 'PR Title',
      type: 'short-input',
      placeholder: 'Generated from the task when blank',
      mode: 'advanced',
    },
    {
      id: 'prBody',
      title: 'PR Body',
      type: 'long-input',
      placeholder: 'Generated from the task and Codex summary when blank',
      mode: 'advanced',
    },
    {
      id: 'reasoningEffort',
      title: 'Reasoning Effort (Step Override)',
      type: 'dropdown',
      emptyIsValid: true,
      placeholder: 'Inherit layered default',
      options: [
        { label: 'Inherit layered default', id: '' },
        ...CODEX_REASONING_EFFORTS.map((effort) => ({ label: effort, id: effort })),
      ],
      mode: 'advanced',
    },
    {
      id: 'networkAccess',
      title: 'Agent Shell Network',
      type: 'switch',
      hidden: true,
      description: 'Allow model-generated shell commands to access the network.',
      tooltip:
        'The Codex control plane can always reach OpenAI. This switch only changes network access for shell commands Codex runs inside the repository.',
      mode: 'advanced',
    },
  ],
  tools: { access: [] },
  inputs: {
    mode: { type: 'string', description: 'Execution mode: Plan (cloud_plan) or Create PR (cloud)' },
    task: { type: 'string', description: 'Instruction for Codex' },
    agentId: {
      type: 'string',
      description:
        'Internal logical agent identity managed by the Agent selector; matching values share an instance',
    },
    agentConfig: {
      type: 'json',
      description: 'Hidden Agent overlay mirror used for collaborative copy semantics',
    },
    model: { type: 'string', description: 'Pinned Codex catalog model' },
    apiKey: { type: 'string', description: 'OpenAI API key' },
    owner: { type: 'string', description: 'GitHub repository owner' },
    repo: { type: 'string', description: 'GitHub repository name' },
    githubToken: { type: 'string', description: 'GitHub token' },
    baseBranch: { type: 'string', description: 'Branch to inspect or use as the PR base' },
    branchName: { type: 'string', description: 'New branch to create' },
    draft: { type: 'boolean', description: 'Open the pull request as a draft' },
    prTitle: { type: 'string', description: 'Pull request title' },
    prBody: { type: 'string', description: 'Pull request body' },
    reasoningEffort: { type: 'string', description: 'Codex model reasoning effort' },
    networkAccess: {
      type: 'boolean',
      description: 'Allow network access from agent shell commands',
    },
  },
  outputs: {
    content: { type: 'string', description: 'Final Codex message' },
    model: { type: 'string', description: 'Model used for the run' },
    runStatus: { type: 'string', description: 'Terminal Codex run status' },
    agentId: { type: 'string', description: 'Resolved logical Codex agent instance ID' },
    sessionReused: {
      type: 'boolean',
      description: 'Whether this turn continued an existing agent session',
    },
    turnNumber: { type: 'number', description: 'One-based turn number for this agent instance' },
    threadId: { type: 'string', description: 'Native Codex thread ID reused by this agent' },
    changedFiles: { type: 'json', description: 'Files changed by Codex in Create PR mode' },
    diff: { type: 'string', description: 'Unified diff of changes made in Create PR mode' },
    prUrl: { type: 'string', description: 'URL of the created pull request, when applicable' },
    branch: { type: 'string', description: 'Branch pushed in Create PR mode' },
    commands: { type: 'json', description: 'Bounded summaries of Codex tool calls' },
    tokens: { type: 'json', description: 'Token usage statistics' },
    cost: { type: 'json', description: 'Cost attributed by Sim (zero for BYOK)' },
    providerTiming: { type: 'json', description: 'Provider timing information' },
  },
}
