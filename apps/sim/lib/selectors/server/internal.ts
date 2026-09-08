import { getWorkspaceOrganizationAccounts } from '@/lib/credential-groups/application/workspace-organization-accounts'
import { listInternalCredentials } from '@/lib/credentials/application/credential-crud'
import { fetchOllamaEmbeddingModelCatalog } from '@/lib/embeddings/ollama-model-catalog.server'
import { fetchOpenRouterEmbeddingModelCatalog } from '@/lib/embeddings/openrouter-model-catalog.server'
import { getEffectiveEnvironmentVariableNames } from '@/lib/environment/utils'
import { listWorkspaceSandboxes } from '@/lib/execution/remote-sandbox/workspace-sandboxes'
import {
  listKnowledgeDocuments,
  readKnowledgeDocument,
} from '@/lib/knowledge/application/documents'
import { getServiceConfigByProviderId } from '@/lib/oauth/utils'
import type { InternalSelectorKey } from '@/lib/selectors/manifest'
import {
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import {
  detailSelectorResult,
  type ExecuteServerSelectorArgs,
  listSelectorResult,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import { readTableUseCase } from '@/lib/table/application/tables'
import { getColumnId } from '@/lib/table/column-keys'
import { listWorkflows } from '@/lib/workflows/application/list-workflows'
import { filterBlacklistedModels, isProviderBlacklisted } from '@/providers/utils'

const WORKFLOW_PAGE_SIZE = 250
const MAX_WORKFLOWS = 10_000
const MAX_WORKFLOW_PAGES = MAX_WORKFLOWS / WORKFLOW_PAGE_SIZE
const KNOWLEDGE_PAGE_SIZE = 100

function labelWorkflow(
  workflow: { id: string; name: string | null; folderPath: string },
  duplicateNames: ReadonlySet<string>
): string {
  const base = workflow.name || `Workflow ${workflow.id.slice(0, 8)}`
  if (!duplicateNames.has(base)) return base
  const folder =
    workflow.folderPath === '/' ? 'Root' : workflow.folderPath.slice(1).replaceAll('/', ' / ')
  return `${base} (${folder})`
}

async function loadWorkflows(
  args: Parameters<(typeof listWorkflows)['execute']>[0]['principal'],
  workspaceId: string
) {
  const workflows: Array<
    Awaited<ReturnType<(typeof listWorkflows)['execute']>>['workflows'][number]
  > = []
  let cursorKeys: Awaited<ReturnType<(typeof listWorkflows)['execute']>>['nextCursorKeys'] = null
  for (let page = 0; page < MAX_WORKFLOW_PAGES; page += 1) {
    const result = await listWorkflows.execute({
      principal: args,
      input: {
        workspaceId,
        scope: 'active',
        deployedOnly: false,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
        limit: WORKFLOW_PAGE_SIZE,
        ...(cursorKeys ? { cursorKeys } : {}),
      },
    })
    workflows.push(...result.workflows)
    cursorKeys = result.nextCursorKeys
    if (!cursorKeys) break
  }
  if (cursorKeys) throw new SelectorOptionsUnavailableError()
  return workflows
}

export const internalSelectorAttachments = {
  'knowledge.documents': {
    destination: 'fixed',
    async execute(args: ExecuteServerSelectorArgs) {
      if (!args.workspaceId) throw new SelectorContextUnavailableError()
      const knowledgeBaseId = args.context.knowledgeBaseId!
      if (args.request.kind === 'detail') {
        const result = await readKnowledgeDocument.execute({
          principal: args.principal,
          input: {
            knowledgeBaseId,
            documentId: args.request.id,
            assertedWorkspaceId: args.workspaceId,
          },
        })
        return detailSelectorResult({
          id: result.document.id,
          label: result.document.filename,
        })
      }

      const offset = args.request.cursor ? Number(args.request.cursor) : 0
      if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid selector cursor')
      const result = await listKnowledgeDocuments.execute({
        principal: args.principal,
        input: {
          knowledgeBaseId,
          assertedWorkspaceId: args.workspaceId,
          enabledFilter: 'all',
          search: args.request.search,
          limit: KNOWLEDGE_PAGE_SIZE,
          offset,
          sortBy: 'filename',
          sortOrder: 'asc',
        },
      })
      const nextOffset = result.pagination.offset + result.pagination.limit
      return listSelectorResult(
        result.documents.map((document) => ({ id: document.id, label: document.filename })),
        result.pagination.hasMore ? String(nextOffset) : undefined
      )
    },
  },
  'sim.workflows': {
    destination: 'fixed',
    async execute(args: ExecuteServerSelectorArgs) {
      if (!args.workspaceId) throw new SelectorContextUnavailableError()
      const workflows = (await loadWorkflows(args.principal, args.workspaceId)).filter(
        (workflow) => workflow.id !== args.context.excludeWorkflowId
      )
      const names = workflows.map(
        (workflow) => workflow.name || `Workflow ${workflow.id.slice(0, 8)}`
      )
      const seen = new Set<string>()
      const duplicates = new Set<string>()
      for (const name of names) {
        if (seen.has(name)) duplicates.add(name)
        seen.add(name)
      }
      const options = workflows
        .map((workflow) => ({
          id: workflow.id,
          label: labelWorkflow(workflow, duplicates),
        }))
        .sort((left, right) => left.label.localeCompare(right.label))
      if (args.request.kind === 'detail') {
        const detailId = args.request.id
        return detailSelectorResult(options.find((option) => option.id === detailId) ?? null)
      }
      return listSelectorResult(options)
    },
  },
  'table.columns': {
    destination: 'fixed',
    async execute(args: ExecuteServerSelectorArgs) {
      if (!args.workspaceId) throw new SelectorContextUnavailableError()
      const { table } = await readTableUseCase.execute({
        principal: args.principal,
        input: { tableId: args.context.tableId!, workspaceId: args.workspaceId },
      })
      const options = (table.schema?.columns ?? [])
        .filter((column) => column.unique)
        .map((column) => ({ id: getColumnId(column), label: column.name }))
      if (args.request.kind === 'detail') {
        const detailId = args.request.id
        return detailSelectorResult(options.find((option) => option.id === detailId) ?? null)
      }
      return listSelectorResult(options)
    },
  },
  'table.outputColumns': {
    destination: 'fixed',
    async execute(args: ExecuteServerSelectorArgs) {
      if (!args.workspaceId) throw new SelectorContextUnavailableError()
      const { table } = await readTableUseCase.execute({
        principal: args.principal,
        input: { tableId: args.context.tableId!, workspaceId: args.workspaceId },
      })
      const options = (table.schema?.columns ?? []).map((column) => ({
        id: getColumnId(column),
        label: column.name,
      }))
      if (args.request.kind === 'detail') {
        const detailId = args.request.id
        return detailSelectorResult(options.find((option) => option.id === detailId) ?? null)
      }
      return listSelectorResult(options)
    },
  },
  'workspace.credentialProviders': {
    destination: 'fixed',
    async execute(args: ExecuteServerSelectorArgs) {
      if (!args.workspaceId) throw new SelectorContextUnavailableError()
      const result = await listInternalCredentials.execute({
        principal: args.principal,
        input: { workspaceId: args.workspaceId, type: 'oauth' },
      })
      if (result.mode !== 'list') throw new Error('Unexpected credential lookup result')
      const seen = new Set<string>()
      const options = result.credentials
        .flatMap((credential) => {
          if (!credential.providerId || seen.has(credential.providerId)) return []
          seen.add(credential.providerId)
          const service = getServiceConfigByProviderId(credential.providerId)
          return [{ id: credential.providerId, label: service?.name ?? credential.providerId }]
        })
        .sort((left, right) => left.label.localeCompare(right.label))
      if (args.request.kind === 'detail') {
        const detailId = args.request.id
        return detailSelectorResult(
          options.find((option) => option.id === detailId) ?? {
            id: detailId,
            label: getServiceConfigByProviderId(detailId)?.name ?? detailId,
          }
        )
      }
      return listSelectorResult(options)
    },
  },
  'workspace.credentialGroupProviders': {
    destination: 'fixed',
    async execute(args: ExecuteServerSelectorArgs) {
      if (!args.workspaceId) throw new SelectorContextUnavailableError()
      const result = await getWorkspaceOrganizationAccounts.execute({
        principal: args.principal,
        input: { workspaceId: args.workspaceId },
      })
      if (!result.allowed) throw new SelectorOptionsUnavailableError()
      const options = result.providers
      if (args.request.kind === 'detail') {
        const id = args.request.id
        return detailSelectorResult(options.find((option) => option.id === id) ?? null)
      }
      return listSelectorResult(options)
    },
  },
  'workspace.organizationMcpProviders': {
    destination: 'fixed',
    async execute(args: ExecuteServerSelectorArgs) {
      if (!args.workspaceId) throw new SelectorContextUnavailableError()
      const result = await getWorkspaceOrganizationAccounts.execute({
        principal: args.principal,
        input: { workspaceId: args.workspaceId },
      })
      if (!result.allowed) throw new SelectorOptionsUnavailableError()
      const options = result.mcpProviders
      if (args.request.kind === 'detail') {
        const id = args.request.id
        return detailSelectorResult(options.find((option) => option.id === id) ?? null)
      }
      return listSelectorResult(options)
    },
  },
  'workspace.secretNames': {
    destination: 'fixed',
    async execute(args: ExecuteServerSelectorArgs) {
      if (!args.workspaceId) throw new SelectorContextUnavailableError()
      const names = await getEffectiveEnvironmentVariableNames(
        args.requesterUserId,
        args.workspaceId
      )
      return listSelectorResult(names.map((name) => ({ id: name, label: name })))
    },
  },
  'workspace.rawSecretNames': {
    destination: 'fixed',
    async execute(args: ExecuteServerSelectorArgs) {
      if (!args.workspaceId) throw new SelectorContextUnavailableError()
      const result = await listInternalCredentials.execute({
        principal: args.principal,
        input: { workspaceId: args.workspaceId },
      })
      if (result.mode !== 'list') throw new Error('Unexpected credential lookup result')
      const names = new Set(
        result.credentials.flatMap((credential) =>
          (credential.type === 'env_workspace' || credential.type === 'env_personal') &&
          credential.role === 'admin' &&
          credential.envKey
            ? [credential.envKey]
            : []
        )
      )
      return listSelectorResult([...names].sort().map((name) => ({ id: name, label: name })))
    },
  },
  'workspace.sandboxes': {
    destination: 'fixed',
    async execute(args: ExecuteServerSelectorArgs) {
      if (!args.workspaceId) throw new SelectorContextUnavailableError()
      const sandboxes = await listWorkspaceSandboxes(args.workspaceId)
      const language = args.context.language
      if (args.request.kind === 'detail') {
        const detailId = args.request.id
        const sandbox = sandboxes.find((candidate) => candidate.id === detailId)
        if (!sandbox) return detailSelectorResult(null)
        const wrongLanguage =
          (language === 'python' || language === 'javascript') && sandbox.language !== language
        return detailSelectorResult({
          id: sandbox.id,
          label: wrongLanguage ? `${sandbox.name} · wrong language for this block` : sandbox.name,
        })
      }
      return listSelectorResult(
        sandboxes
          .filter((sandbox) => !language || language === 'shell' || sandbox.language === language)
          .map((sandbox) => ({ id: sandbox.id, label: sandbox.name }))
      )
    },
  },
  'providers.ollamaEmbeddingModels': {
    destination: 'fixed',
    async execute(args: ExecuteServerSelectorArgs) {
      if (!args.workspaceId) throw new SelectorContextUnavailableError()
      if (isProviderBlacklisted('ollama')) return listSelectorResult([])
      const models = await fetchOllamaEmbeddingModelCatalog(args.signal)
      return listSelectorResult(
        filterBlacklistedModels(models.map((model) => model.id)).map((id) => {
          const dimensions = models.find((model) => model.id === id)?.dimensions
          return {
            id,
            /**
             * The width is in the label because matching it to
             * `EMBEDDING_OUTPUT_DIMS` is the operator's job and Ollama is the one
             * provider whose widths Sim cannot know ahead of time.
             */
            label: dimensions === undefined ? id : `${id} (${dimensions})`,
          }
        })
      )
    },
  },
  'providers.openrouterEmbeddingModels': {
    destination: 'fixed',
    async execute(args: ExecuteServerSelectorArgs) {
      if (!args.workspaceId) throw new SelectorContextUnavailableError()
      if (isProviderBlacklisted('openrouter')) return listSelectorResult([])
      const models = filterBlacklistedModels(
        (await fetchOpenRouterEmbeddingModelCatalog(args.signal)).map((model) => model.id)
      )
      return listSelectorResult([...new Set(models)].map((model) => ({ id: model, label: model })))
    },
  },
} as const satisfies ServerSelectorAttachmentMap<InternalSelectorKey>
