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
 * Invokes a Claude Platform Managed Agent (cloud or self-hosted) as a
 * workflow node and returns the assistant's final text. The environment type
 * is resolved server-side from the selected environment, so one block covers
 * both cloud and self-hosted — memory and metadata route automatically.
 *
 * The Claude Platform API key is stored once per workspace under Settings →
 * API Keys (BYOK provider `claude-platform`) and resolved server-side; it
 * never enters the block config or the browser.
 */
export const ManagedAgentBlock: BlockConfig = {
  type: 'managed_agent',
  name: 'Claude Managed Agents',
  description: 'Run a Claude Platform Managed Agent',
  authMode: AuthMode.ApiKey,
  longDescription:
    "Invoke a Claude Platform Managed Agent from a workflow. Pick an agent and environment from your linked Claude workspace, optionally attach vaults, a memory store, and files, and add metadata tags. Returns the assistant's final text. Store your Claude Platform API key once per workspace under Settings → API Keys.",
  category: 'tools',
  integrationType: IntegrationType.AI,
  docsLink: 'https://docs.sim.ai/integrations/managed-agent',
  bgColor: '#DA7756',
  iconColor: '#DA7756',
  icon: ClaudeIcon,
  subBlocks: [
    {
      id: 'agent',
      title: 'Agent',
      type: 'combobox',
      required: true,
      placeholder: 'Select an agent from your Claude workspace…',
      commandSearchable: true,
      options: [],
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
      type: 'combobox',
      required: false,
      placeholder: 'Optional — pick zero or more OAuth vaults',
      commandSearchable: true,
      multiSelect: true,
      options: [],
      fetchOptions: fetchManagedAgentVaultOptions,
    },
    {
      id: 'vaultsAck',
      title:
        'I own or am authorized to use these vaults. I understand this means this agent can assume the identity granted by them.',
      type: 'switch',
      required: false,
      description: 'Required when at least one vault is selected above.',
    },
    {
      id: 'memoryStoreId',
      title: 'Memory store',
      type: 'combobox',
      required: false,
      placeholder: 'Optional — pick a memory store',
      commandSearchable: true,
      options: [],
      fetchOptions: fetchManagedAgentMemoryStoreOptions,
    },
    {
      id: 'memoryAccess',
      title: 'Memory access',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Read + write (default)', id: 'read_write' },
        { label: 'Read only', id: 'read_only' },
      ],
      value: () => 'read_write',
      condition: { field: 'memoryStoreId', value: '', not: true },
      description: 'read_write pushes changes back on session exit; read_only never writes.',
    },
    {
      id: 'files',
      title: 'Files',
      type: 'table',
      required: false,
      columns: ['File ID'],
      description:
        'Files-API file ids (file_...) to attach to the session as file resources (cloud environments).',
    },
    {
      id: 'sessionParameters',
      title: 'Metadata',
      type: 'table',
      required: false,
      columns: ['Key', 'Value'],
      description:
        'Optional key/value metadata forwarded on the session. On self-hosted environments each key is exposed to the agent as an env var.',
    },
  ],
  tools: {
    access: ['managed_agent_run_session'],
  },
  inputs: {
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
    files: { type: 'json', description: 'Files-API file ids to attach as file resources.' },
    sessionParameters: { type: 'json', description: 'Session metadata (key/value).' },
  },
  outputs: {
    content: { type: 'string', description: "The Managed Agent's final assistant text." },
    sessionId: { type: 'string', description: 'Anthropic session id, for logs and linking.' },
  },
}

export const ManagedAgentBlockMeta = {
  tags: ['agentic', 'llm'],
  url: 'https://platform.claude.com/',
  templates: [
    {
      icon: ClaudeIcon,
      title: 'Delegate a task to a Claude Managed Agent',
      prompt:
        "Build a workflow that opens a Claude Platform Managed Agent session, optionally attaches a memory store and files, and captures the agent's response.",
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['automation', 'analysis'],
    },
  ],
} as const satisfies BlockMeta
