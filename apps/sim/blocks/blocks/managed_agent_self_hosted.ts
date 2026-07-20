import { ClaudeIcon } from '@/components/icons'
import { env } from '@/lib/core/config/env'
import {
  fetchManagedAgentAgentOptions,
  fetchManagedAgentConnectionOptions,
  fetchManagedAgentMemoryStoreOptions,
  fetchManagedAgentSelfHostedDefaults,
  fetchManagedAgentSelfHostedEnvironmentOptions,
  fetchManagedAgentVaultOptions,
} from '@/lib/managed-agents/subblock-options'
import type { BlockConfig, BlockMeta, SubBlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

/**
 * Feature-flag gate for the memory-store + memory-access fields on the
 * self-hosted variant. Off by default: Claude self-hosted environments
 * do not currently support the memory-store resource attach on the
 * session API. Deployers whose self-hosted agent sandbox has a custom
 * memory-mount path can flip this on to expose the fields, and the
 * key/value pair still ends up on the session's `metadata` for the
 * sandbox to pick up.
 */
export function isSelfHostedMemoryEnabled(): boolean {
  const raw = env.NEXT_PUBLIC_MANAGED_AGENT_SELF_HOSTED_MEMORY_ENABLED
  if (typeof raw !== 'string') return false
  const normalized = raw.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

const memorySubBlocks: SubBlockConfig[] = isSelfHostedMemoryEnabled()
  ? [
      {
        id: 'memoryStoreId',
        title: 'Memory Store',
        type: 'combobox',
        required: false,
        placeholder: 'Optional — pick a memory store or leave empty',
        commandSearchable: true,
        options: [],
        dependsOn: ['connection'],
        fetchOptions: fetchManagedAgentMemoryStoreOptions,
      },
      {
        id: 'memoryAccess',
        title: 'Memory Access',
        type: 'dropdown',
        required: false,
        options: [
          { label: 'Read + write (default)', id: 'read_write' },
          { label: 'Read only', id: 'read_only' },
        ],
        value: () => 'read_write',
        dependsOn: ['memoryStoreId'],
        condition: { field: 'memoryStoreId', value: '', not: true },
        description:
          'read_write pushes changes back on session exit. read_only pulls only and never writes.',
      },
    ]
  : []

/**
 * Claude Managed Agents block — self-hosted variant.
 *
 * Same session-create shape as the cloud block **without** the
 * `resources` array. Session metadata (top-level `metadata` field) is
 * exposed to the self-hosted agent sandbox as env vars, so this
 * block's Session parameters table is where you set the keys your
 * deployment reads. The set of supported keys is deployment-specific
 * — seed defaults with `NEXT_PUBLIC_MANAGED_AGENT_SELF_HOSTED_DEFAULTS`.
 *
 * The environment picker is filtered to `config.type === 'self_hosted'`.
 * Icon renders black-on-white to visually differentiate from the cloud
 * block's warm-orange tile.
 */
export const ManagedAgentSelfHostedBlock: BlockConfig = {
  type: 'managed_agent_self_hosted',
  name: 'Claude Managed Agents (self-hosted)',
  description: 'Run a Claude Platform Managed Agent (self-hosted environments)',
  authMode: AuthMode.ApiKey,
  longDescription:
    "Invoke a Claude Platform Managed Agent running in a self-hosted sandbox on your own infrastructure. Pick a linked Claude workspace, agent, and self-hosted environment. Attach vaults. Set metadata keys the self-hosted agent sandbox forwards to the container as env vars (keys are deployment-specific). The block returns the assistant's final text.",
  category: 'tools',
  integrationType: IntegrationType.AI,
  docsLink: 'https://docs.sim.ai/integrations/managed-agent',
  bgColor: '#000000',
  icon: ClaudeIcon,
  nodeWidth: 400,
  subBlocks: [
    {
      id: 'connection',
      title: 'Claude Workspace',
      type: 'combobox',
      required: true,
      placeholder: 'Select a linked Claude workspace…',
      commandSearchable: true,
      options: [],
      fetchOptions: fetchManagedAgentConnectionOptions,
    },
    {
      id: 'environment',
      title: 'Self-hosted Environment',
      type: 'combobox',
      required: true,
      placeholder: 'Select a self-hosted environment…',
      commandSearchable: true,
      options: [],
      dependsOn: ['connection'],
      fetchOptions: fetchManagedAgentSelfHostedEnvironmentOptions,
    },
    {
      // Constant — self-hosted block only runs against self-hosted envs.
      // The session-client uses this to build the metadata-shaped payload
      // (no top-level `resources`, memory folded into metadata).
      id: 'environmentType',
      title: 'Environment Type',
      type: 'short-input',
      value: () => 'self_hosted',
      hidden: true,
    },
    {
      id: 'vaults',
      title: 'Credential vaults',
      type: 'combobox',
      required: false,
      placeholder: 'Optional — pick zero or more OAuth vaults',
      commandSearchable: true,
      multiSelect: true,
      options: [],
      dependsOn: ['connection'],
      fetchOptions: fetchManagedAgentVaultOptions,
    },
    ...memorySubBlocks,
    {
      id: 'agent',
      title: 'Agent',
      type: 'combobox',
      required: true,
      placeholder: 'Select an agent from this workspace…',
      commandSearchable: true,
      options: [],
      dependsOn: ['connection'],
      fetchOptions: fetchManagedAgentAgentOptions,
    },
    {
      id: 'userMessage',
      title: 'User message',
      type: 'long-input',
      required: true,
      placeholder: 'Ask the Managed Agent to do something…',
    },
    {
      // Session metadata forwarded to the self-hosted agent sandbox as
      // env vars. The set of supported keys is deployment-specific and
      // lives with the deployer, not in this repo. Seed rows come from
      // the server-only `MANAGED_AGENT_SELF_HOSTED_DEFAULTS` env var,
      // fetched via `/api/managed-agent-defaults` — the values never
      // enter the client bundle, so deployers can safely include
      // anything their sandbox reads.
      id: 'sessionParameters',
      title: 'Session parameters',
      type: 'table',
      required: false,
      columns: ['Key', 'Value'],
      fetchDefaultRows: fetchManagedAgentSelfHostedDefaults,
      description:
        'Key/value pairs forwarded to the self-hosted agent sandbox as environment variables. Supported keys depend on your deployment — consult your deployment docs. Value cells support <block.output> / <var.name> references.',
    },
  ],
  tools: {
    access: ['managed_agent_run_session'],
  },
  inputs: {
    connection: { type: 'string', description: 'Managed Agent connection id.' },
    agent: { type: 'string', description: 'Managed-agent id inside the linked Claude workspace.' },
    environment: { type: 'string', description: 'Self-hosted environment id.' },
    environmentType: { type: 'string', description: 'Always "self_hosted" for this block.' },
    vaults: { type: 'json', description: 'Vault ids for MCP auth (array of strings).' },
    memoryStoreId: {
      type: 'string',
      description:
        "Optional Agent Memory Store id. Only exposed when NEXT_PUBLIC_MANAGED_AGENT_SELF_HOSTED_MEMORY_ENABLED is truthy; forwarded on the session's `metadata` for the self-hosted agent sandbox to consume.",
    },
    memoryAccess: {
      type: 'string',
      description: "Memory store access mode — 'read_write' (default) or 'read_only'.",
    },
    sessionParameters: {
      type: 'json',
      description:
        'Session parameters (key/value) forwarded to the self-hosted agent sandbox as env vars.',
    },
    userMessage: { type: 'string', description: 'The user message to send to the agent.' },
  },
  outputs: {
    content: { type: 'string', description: "The Managed Agent's final assistant text." },
    sessionId: {
      type: 'string',
      description: 'Anthropic session id — logged so downstream steps can link to the run.',
    },
  },
}

export const ManagedAgentSelfHostedBlockMeta = {
  tags: ['agent', 'anthropic', 'claude', 'session', 'managed-agent', 'self-hosted'],
  url: 'https://platform.claude.com/',
  templates: [
    {
      icon: ClaudeIcon,
      title: 'Delegate a repo-scoped code review to a self-hosted Managed Agent',
      prompt:
        'Build a workflow that receives a repo URL and ref, invokes a Claude Platform Managed Agent in a self-hosted environment with SOURCE_TYPE=git session parameters, and captures the review as a summary comment.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['automation', 'code-review'],
    },
    {
      icon: ClaudeIcon,
      title: 'Trigger a scheduled analysis on a git-repo-mounted agent',
      prompt:
        "Create a scheduled workflow that opens a Managed Agent session against a self-hosted environment, mounts a repository via git-repo manifest session parameters (SOURCE_TYPE=repo), and stores the agent's analysis in a tables block.",
      modules: ['scheduled', 'agent', 'tables', 'workflows'],
      category: 'engineering',
      tags: ['automation', 'analysis'],
    },
  ],
  skills: [
    {
      name: 'run-self-hosted-managed-agent',
      description:
        'Delegate a repo-scoped task to a self-hosted Managed Agent that mounts the repo via session parameters.',
      content:
        "# Run Self-Hosted Managed Agent\n\nWhen a Managed Agent needs to reason about deployment-specific context (e.g. a repo checkout), configure it via session parameters — the self-hosted agent sandbox reads each key/value pair as an env var.\n\n## Steps\n1. Pick a self-hosted environment.\n2. Set the session-parameter keys your deployment defines.\n3. Write the user message referring to whatever the session parameters set up.\n\n## Output\nThe block returns the agent's final text.",
    },
  ],
} as const satisfies BlockMeta
