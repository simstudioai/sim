import { ClaudeIcon } from '@/components/icons'
import {
  fetchManagedAgentAgentOptions,
  fetchManagedAgentCloudEnvironmentOptions,
  fetchManagedAgentConnectionOptions,
  fetchManagedAgentMemoryStoreOptions,
  fetchManagedAgentVaultOptions,
} from '@/lib/managed-agents/subblock-options'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

/**
 * Claude Managed Agents block — cloud (Anthropic-managed) environments.
 *
 * Supports the full `POST /v1/sessions` shape:
 *   - `agent`, `environment_id`, `vault_ids`
 *   - `resources: [{type: 'memory_store', ...}, {type: 'file', ...}]`
 *   - `metadata: {...}` (arbitrary key/value tags)
 *
 * The environment picker is filtered to `config.type === 'cloud'` so this
 * block only lists cloud envs. Self-hosted envs live on the sibling
 * `managed_agent_self_hosted` block.
 */
export const ManagedAgentCloudBlock: BlockConfig = {
  type: 'managed_agent_cloud',
  name: 'Claude Managed Agents',
  description: 'Run a Claude Platform Managed Agent (cloud environments)',
  authMode: AuthMode.ApiKey,
  longDescription:
    "Invoke a Claude Platform Managed Agent running in an Anthropic-managed cloud sandbox. Pick a linked Claude workspace, agent, and cloud environment. Attach vaults, a memory store, and files via the session resources array. Add opaque metadata tags if needed. The block returns the assistant's final text.",
  category: 'tools',
  integrationType: IntegrationType.AI,
  docsLink: 'https://docs.sim.ai/integrations/managed-agent',
  bgColor: '#DA7756',
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
      title: 'Cloud Environment',
      type: 'combobox',
      required: true,
      placeholder: 'Select a cloud environment…',
      commandSearchable: true,
      options: [],
      dependsOn: ['connection'],
      fetchOptions: fetchManagedAgentCloudEnvironmentOptions,
    },
    {
      // Constant — cloud block only ever runs against cloud envs, so the
      // session-client builds the cloud-shaped payload (resources +
      // metadata, no session_parameters routing).
      id: 'environmentType',
      title: 'Environment Type',
      type: 'short-input',
      value: () => 'cloud',
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
    {
      // Memory store — attached as a `memory_store` resource entry.
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
      // Free-form session metadata. Cloud envs store these as opaque
      // tags; use for downstream analytics or your own bookkeeping.
      id: 'sessionParameters',
      title: 'Metadata',
      type: 'table',
      required: false,
      columns: ['Key', 'Value'],
      description:
        'Optional key/value metadata forwarded on the session (top-level `metadata` field).',
    },
    {
      // File attachments — each row is a Files-API `file_...` id plus
      // an optional mount path. Anthropic mounts each file into the
      // session container so the agent can read it.
      id: 'files',
      title: 'Files',
      type: 'table',
      required: false,
      columns: ['File ID', 'Mount path'],
      description:
        'Files-API file ids (file_...) to mount into the session. Mount path is optional; Anthropic picks a default when omitted.',
    },
  ],
  tools: {
    access: ['managed_agent_run_session'],
  },
  inputs: {
    connection: { type: 'string', description: 'Managed Agent connection id.' },
    agent: { type: 'string', description: 'Managed-agent id inside the linked Claude workspace.' },
    environment: { type: 'string', description: 'Cloud environment id.' },
    environmentType: { type: 'string', description: 'Always "cloud" for this block.' },
    vaults: { type: 'json', description: 'Vault ids for MCP auth (array of strings).' },
    memoryStoreId: { type: 'string', description: 'Optional Agent Memory Store id.' },
    memoryAccess: {
      type: 'string',
      description: "Memory store access mode — 'read_write' (default) or 'read_only'.",
    },
    files: { type: 'json', description: 'File attachments — [{fileId, mountPath?}].' },
    sessionParameters: {
      type: 'json',
      description: 'Session metadata (top-level `metadata` field on the session).',
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

export const ManagedAgentCloudBlockMeta = {
  tags: ['agent', 'anthropic', 'claude', 'session', 'managed-agent', 'cloud'],
  url: 'https://platform.claude.com/',
  templates: [
    {
      icon: ClaudeIcon,
      title: 'Delegate an analysis task to a cloud Managed Agent',
      prompt:
        "Build a workflow that opens a Managed Agent session in an Anthropic-managed cloud sandbox, attaches a memory store and any relevant files, and captures the agent's response.",
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['automation', 'analysis'],
    },
    {
      icon: ClaudeIcon,
      title: 'Route a customer request to a vault-backed cloud agent',
      prompt:
        "Read a customer request from a webhook, invoke a cloud Managed Agent bound to an OAuth vault for MCP tool access, and return the agent's response as a chat reply.",
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['automation', 'customer-support'],
    },
  ],
  skills: [
    {
      name: 'run-cloud-managed-agent',
      description:
        'Delegate a task to a cloud Claude Platform Managed Agent — optionally attaching a memory store and files as session resources.',
      content:
        "# Run Cloud Managed Agent\n\nInvoke a Managed Agent running in Anthropic's cloud sandbox from a Sim workflow.\n\n## Steps\n1. Pick the connection (linked Claude workspace).\n2. Pick the cloud agent and environment.\n3. Optionally attach vaults, a memory store (with access mode), and files.\n4. Optionally add metadata tags for bookkeeping.\n5. Write the user message; `<block.output>` references resolve at run time.\n\n## Output\nThe block returns the assistant's final text as `content`. Chain downstream blocks as needed.",
    },
  ],
} as const satisfies BlockMeta
