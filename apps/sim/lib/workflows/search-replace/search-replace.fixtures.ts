import type { WorkflowSearchWorkflow } from '@/lib/workflows/search-replace/types'
import type { SubBlockConfig } from '@/blocks/types'

export const SEARCH_REPLACE_BLOCK_CONFIGS: Record<string, { subBlocks: SubBlockConfig[] }> = {
  agent: {
    subBlocks: [
      { id: 'systemPrompt', title: 'System Prompt', type: 'long-input' },
      {
        id: 'credential',
        title: 'Credential',
        type: 'oauth-input',
        serviceId: 'gmail',
        canonicalParamId: 'oauthCredential',
      },
      {
        id: 'label',
        title: 'Label',
        type: 'folder-selector',
        selectorKey: 'gmail.labels',
        dependsOn: ['credential'],
      },
    ],
  },
  knowledge: {
    subBlocks: [
      {
        id: 'knowledgeBaseIds',
        title: 'Knowledge Bases',
        type: 'knowledge-base-selector',
        canonicalParamId: 'knowledgeBaseId',
      },
      {
        id: 'documentId',
        title: 'Document',
        type: 'document-selector',
        serviceId: 'knowledge',
        selectorKey: 'knowledge.documents',
        dependsOn: ['knowledgeBaseIds'],
      },
    ],
  },
  api: {
    subBlocks: [
      { id: 'body', title: 'Body', type: 'code' },
      { id: 'headers', title: 'Headers', type: 'table' },
    ],
  },
  slack: {
    subBlocks: [
      {
        id: 'authMethod',
        title: 'Authentication Method',
        type: 'dropdown',
      },
      {
        id: 'credential',
        title: 'Slack Account',
        type: 'oauth-input',
        serviceId: 'slack',
        canonicalParamId: 'oauthCredential',
        condition: { field: 'authMethod', value: 'oauth' },
      },
      {
        id: 'text',
        title: 'Message',
        type: 'long-input',
      },
      {
        id: 'channel',
        title: 'Channel',
        type: 'channel-selector',
        serviceId: 'slack',
        selectorKey: 'slack.channels',
        dependsOn: ['credential'],
      },
      {
        id: 'attachmentFiles',
        title: 'Attachments',
        type: 'file-upload',
        canonicalParamId: 'files',
        condition: { field: 'operation', value: 'send' },
        mode: 'basic',
      },
    ],
  },
  workflow_input: {
    subBlocks: [
      {
        id: 'workflowId',
        title: 'Workflow',
        type: 'workflow-selector',
        selectorKey: 'sim.workflows',
      },
      {
        id: 'inputMapping',
        title: 'Inputs',
        type: 'input-mapping',
        dependsOn: ['workflowId'],
      },
    ],
  },
}

export function createSearchReplaceWorkflowFixture(): WorkflowSearchWorkflow {
  return {
    blocks: {
      'agent-1': {
        id: 'agent-1',
        type: 'agent',
        name: 'Agent 1',
        position: { x: 0, y: 0 },
        enabled: true,
        outputs: {},
        subBlocks: {
          systemPrompt: {
            id: 'systemPrompt',
            type: 'long-input',
            value: 'Email {{OLD_SECRET}} and then email again. Use <start.output>.',
          },
          credential: {
            id: 'credential',
            type: 'oauth-input',
            value: 'gmail-credential-old',
          },
          label: {
            id: 'label',
            type: 'folder-selector',
            value: 'INBOX',
          },
        },
      },
      'knowledge-1': {
        id: 'knowledge-1',
        type: 'knowledge',
        name: 'Knowledge 1',
        position: { x: 200, y: 0 },
        enabled: true,
        outputs: {},
        subBlocks: {
          knowledgeBaseIds: {
            id: 'knowledgeBaseIds',
            type: 'knowledge-base-selector',
            value: 'kb-old,kb-second',
          },
          documentId: {
            id: 'documentId',
            type: 'document-selector',
            value: 'doc-old',
          },
        },
      },
      'api-1': {
        id: 'api-1',
        type: 'api',
        name: 'API 1',
        position: { x: 400, y: 0 },
        enabled: true,
        outputs: {},
        subBlocks: {
          body: {
            id: 'body',
            type: 'code',
            value: { content: 'email in nested body' },
          },
          headers: {
            id: 'headers',
            type: 'table',
            value: [
              { id: 'row-1', cells: { Key: 'Authorization', Value: 'Bearer {{OLD_SECRET}}' } },
            ],
          },
        },
      },
      'locked-1': {
        id: 'locked-1',
        type: 'agent',
        name: 'Locked Agent',
        position: { x: 600, y: 0 },
        enabled: true,
        locked: true,
        outputs: {},
        subBlocks: {
          systemPrompt: {
            id: 'systemPrompt',
            type: 'long-input',
            value: 'email from locked block',
          },
        },
      },
    },
  }
}
