import { ClaudeIcon } from '@/components/icons'
import {
  fetchManagedAgentAgentOptions,
  fetchManagedAgentEnvironmentOptions,
  fetchManagedAgentMemoryStoreOptions,
  fetchManagedAgentVaultOptions,
} from '@/lib/managed-agents/subblock-options'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

/**
 * Claude Managed Agents block.
 *
 * Invokes a Claude Platform Managed Agent (cloud or self-hosted) as a workflow
 * node and returns the assistant's final text. One block covers both models:
 * the Environment type selector filters the environment list and shows only the
 * fields that apply — memory stores and files are cloud-only (self-hosted
 * rejects the `resources` attach), while session metadata works for both.
 *
 * Authentication is a selectable Claude Platform credential (an Anthropic
 * workspace API key). The credential's key is resolved server-side at run
 * time and never enters the block config or the browser.
 */
export const ManagedAgentBlock: BlockConfig = {
  type: 'managed_agent',
  name: 'Claude Managed Agents',
  description: 'Run a Claude Platform Managed Agent',
  authMode: AuthMode.ApiKey,
  longDescription:
    "Invoke a Claude Platform Managed Agent from a workflow. Select a Claude Platform account, pick an agent and environment from that workspace, optionally attach vaults, a memory store, and files, and add metadata tags. Returns the assistant's final text.",
  category: 'tools',
  integrationType: IntegrationType.AI,
  docsLink: 'https://docs.sim.ai/integrations/managed-agent',
  bgColor: '#DA7756',
  iconColor: '#DA7756',
  icon: ClaudeIcon,
  subBlocks: [
    {
      id: 'credential',
      title: 'Claude Platform account',
      type: 'oauth-input',
      serviceId: 'claude-platform',
      credentialKind: 'service-account',
      required: true,
      placeholder: 'Select a Claude Platform credential',
    },
    {
      id: 'environmentType',
      title: 'Environment type',
      type: 'dropdown',
      required: true,
      options: [
        { label: 'Cloud', id: 'cloud' },
        { label: 'Self-hosted', id: 'self_hosted' },
      ],
      value: () => 'cloud',
      description:
        'Self-hosted environments run on your own infrastructure and route memory via session metadata; file attachments are cloud-only.',
    },
    {
      id: 'agent',
      title: 'Agent',
      type: 'combobox',
      required: true,
      placeholder: 'Select an agent from your Claude workspace…',
      commandSearchable: true,
      options: [],
      dependsOn: ['credential'],
      fetchOptions: fetchManagedAgentAgentOptions,
    },
    {
      id: 'environment',
      title: 'Environment',
      type: 'combobox',
      required: true,
      placeholder: 'Select an environment…',
      commandSearchable: true,
      options: [],
      dependsOn: ['credential', 'environmentType'],
      fetchOptions: fetchManagedAgentEnvironmentOptions,
    },
    {
      id: 'userMessage',
      title: 'User message',
      type: 'long-input',
      required: true,
      placeholder: 'Ask the Managed Agent to do something…',
    },
    {
      id: 'vaults',
      title: 'Credential vaults',
      type: 'dropdown',
      required: false,
      mode: 'advanced',
      placeholder: 'Optional — pick zero or more OAuth vaults',
      searchable: true,
      multiSelect: true,
      options: [],
      dependsOn: ['credential'],
      fetchOptions: fetchManagedAgentVaultOptions,
    },
    {
      id: 'vaultsAck',
      title:
        'I own or am authorized to use these vaults. I understand this means this agent can assume the identity granted by them.',
      type: 'switch',
      required: false,
      mode: 'advanced',
      description: 'Required when at least one vault is selected above.',
    },
    {
      id: 'memoryStoreId',
      title: 'Memory store',
      type: 'combobox',
      required: false,
      mode: 'advanced',
      placeholder: 'Optional — pick a memory store',
      commandSearchable: true,
      options: [],
      dependsOn: ['credential'],
      // Cloud only: memory stores attach as `resources[]`, which self-hosted
      // rejects. A self-hosted worker that uses a store reads its id from a
      // Metadata key the author sets explicitly.
      condition: { field: 'environmentType', value: 'cloud' },
      fetchOptions: fetchManagedAgentMemoryStoreOptions,
    },
    {
      id: 'memoryAccess',
      title: 'Memory access',
      type: 'dropdown',
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Read + write (default)', id: 'read_write' },
        { label: 'Read only', id: 'read_only' },
      ],
      value: () => 'read_write',
      condition: {
        field: 'memoryStoreId',
        value: '',
        not: true,
        and: { field: 'environmentType', value: 'cloud' },
      },
      description: 'read_write pushes changes back on session exit; read_only never writes.',
    },
    {
      id: 'memoryInstructions',
      title: 'Memory instructions',
      type: 'long-input',
      required: false,
      mode: 'advanced',
      placeholder: 'Optional — how the agent should use this memory store',
      // Cloud only: instructions are a `resources[]` memory-attach concept the
      // API renders into the system prompt; self-hosted has no resource attach.
      condition: {
        field: 'memoryStoreId',
        value: '',
        not: true,
        and: { field: 'environmentType', value: 'cloud' },
      },
      description: 'Per-attachment guidance rendered into the memory section of the system prompt.',
    },
    {
      id: 'files',
      title: 'Files',
      type: 'table',
      required: false,
      mode: 'advanced',
      // Cloud only: files attach as `resources[]`, which self-hosted rejects.
      condition: { field: 'environmentType', value: 'cloud' },
      columns: ['File ID', 'Mount path'],
      description:
        'Files-API file ids (file_...) to attach as file resources. Mount path is optional.',
    },
    {
      id: 'sessionParameters',
      title: 'Metadata',
      type: 'table',
      required: false,
      mode: 'advanced',
      columns: ['Key', 'Value'],
      description:
        'Optional key/value metadata forwarded on the session. On self-hosted environments each key is exposed to the agent as an env var.',
    },
  ],
  tools: {
    access: ['managed_agent_run_session'],
  },
  inputs: {
    credential: { type: 'string', description: 'Claude Platform credential id.' },
    environmentType: {
      type: 'string',
      description:
        "Environment execution model — 'cloud' or 'self_hosted'. Filters the environment picker and gates cloud-only fields; the actual type is re-resolved server-side for routing.",
    },
    agent: { type: 'string', description: 'Managed-agent id inside the linked Claude workspace.' },
    environment: {
      type: 'string',
      description: 'Environment id inside the linked Claude workspace.',
    },
    userMessage: { type: 'string', description: 'The user message to send to the agent.' },
    vaults: { type: 'json', description: 'Vault ids for MCP auth (array of strings).' },
    vaultsAck: {
      type: 'boolean',
      description: 'Acknowledgement that the author may use the attached vaults.',
    },
    memoryStoreId: { type: 'string', description: 'Optional Agent Memory Store id.' },
    memoryAccess: {
      type: 'string',
      description: "Memory store access mode — 'read_write' (default) or 'read_only'.",
    },
    memoryInstructions: {
      type: 'string',
      description: 'Per-attachment guidance for how the agent should use the memory store.',
    },
    files: { type: 'json', description: 'File attachments — [{fileId, mountPath?}].' },
    sessionParameters: { type: 'json', description: 'Session metadata (key/value).' },
  },
  outputs: {
    content: { type: 'string', description: "The Managed Agent's final assistant text." },
    sessionId: { type: 'string', description: 'Anthropic session id, for logs and linking.' },
    inputTokens: { type: 'number', description: 'Cumulative input tokens for the session.' },
    outputTokens: { type: 'number', description: 'Cumulative output tokens for the session.' },
  },
}

export const ManagedAgentBlockMeta = {
  tags: ['agentic', 'llm'],
  url: 'https://platform.claude.com/',
} as const satisfies BlockMeta
