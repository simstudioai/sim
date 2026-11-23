/**
 * A workflow's deployment as source reads it: whether the API is public, the chat it serves, and
 * whether the draft differs from the live version. Each part is read through the use case that
 * owns it, so a caller who may not read a chat's gate configuration (anyone but a workspace admin)
 * cannot read it here either.
 */
import { isRecordLike, toArray } from '@sim/utils/object'
import { normalizeWorkflowBlockName } from '@sim/workflow-types/workflow'
import { fingerprintOf, type ResourceFingerprint } from '@sim/workspace-code'
import {
  type ChatAuthDecl,
  type ChatDecl,
  type DeploymentDecl,
  deploymentCodec,
} from '@sim/workspace-code/kinds/deployment'
import {
  readWorkflowChatDeployment,
  readWorkflowChatDeploymentStatus,
} from '@/lib/chat-deployments/application/workflow-chat-deployment'
import { readWorkflowDeploymentStatus } from '@/lib/workflows/application/deployments'
import { readWorkflowGraph } from '@/lib/workflows/application/read-workflow-graph'
import type { SourceContext } from '@/lib/workspace-source/application/types'

/** A chat output as stored: a block id and a path, with the block's name when the draft has it. */
interface StoredChatOutput {
  blockId: string
  path: string
  /** The block's name in the draft; absent when the draft no longer holds the block. */
  block?: string
}

/** A served chat, without its password (only whether it has one). */
interface StoredChat {
  identifier: string
  title: string
  description: string | null
  /** How the chat gates access; `null` for a stored value source cannot name. */
  authType: ChatAuthType | null
  hasPassword: boolean
  allowedEmails: string[]
  outputs: StoredChatOutput[]
  customizations: { primaryColor?: string; welcomeMessage?: string; imageUrl?: string }
  includeThinking: boolean
  includeToolCalls: boolean
}

/** A deployed workflow, as the deployment kind reads it. */
export interface StoredDeployment {
  isPublicApi: boolean
  /** The draft differs from the live version. */
  needsRedeployment: boolean
  chat: StoredChat | null
}

const AUTH_TYPES = ['public', 'password', 'email', 'sso'] as const

type ChatAuthType = (typeof AUTH_TYPES)[number]

/** The stored auth type, or `null` for one source cannot name: never read as public. */
function authTypeOf(value: string): ChatAuthType | null {
  return AUTH_TYPES.find((type) => type === value) ?? null
}

function stringsOf(value: unknown): string[] {
  return toArray(value).filter((item): item is string => typeof item === 'string')
}

function customizationsOf(value: unknown): StoredChat['customizations'] {
  if (!isRecordLike(value)) return {}
  const pick = (field: string) => {
    const raw = value[field]
    return typeof raw === 'string' && raw !== '' ? { [field]: raw } : {}
  }
  return { ...pick('primaryColor'), ...pick('welcomeMessage'), ...pick('imageUrl') }
}

function outputsOf(value: unknown): Array<{ blockId: string; path: string }> {
  return toArray(value).flatMap((item) =>
    isRecordLike(item) && typeof item.blockId === 'string' && typeof item.path === 'string'
      ? [{ blockId: item.blockId, path: item.path }]
      : []
  )
}

/** The draft's block names by id, and ids by normalized name. */
export async function readBlockNames(
  ctx: SourceContext,
  workflowId: string
): Promise<{ nameOf: Map<string, string>; idOf: Map<string, string> }> {
  const graph = await readWorkflowGraph.execute({ principal: ctx.principal, input: { workflowId } })
  const nameOf = new Map<string, string>()
  const idOf = new Map<string, string>()
  for (const [id, block] of Object.entries(graph.blocks)) {
    nameOf.set(id, block.name)
    idOf.set(normalizeWorkflowBlockName(block.name), id)
  }
  return { nameOf, idOf }
}

/** The chat workflow `workflowId` serves, or `null` when it serves none. */
async function readChat(ctx: SourceContext, workflowId: string): Promise<StoredChat | null> {
  const { principal } = ctx
  const status = await readWorkflowChatDeploymentStatus.execute({
    principal,
    input: { workflowId },
  })
  if (!status.isDeployed || !status.deployment) return null
  const { deployment } = await readWorkflowChatDeployment.execute({
    principal,
    input: { workflowId },
  })
  const outputs = outputsOf(deployment.outputConfigs)
  const { nameOf } = outputs.length > 0 ? await readBlockNames(ctx, workflowId) : { nameOf: null }
  return {
    identifier: deployment.identifier,
    title: deployment.title,
    description: deployment.description,
    authType: authTypeOf(deployment.authType),
    hasPassword: deployment.hasPassword,
    allowedEmails: stringsOf(deployment.allowedEmails),
    outputs: outputs.map((output) => {
      const block = nameOf?.get(output.blockId)
      return block === undefined ? output : { ...output, block }
    }),
    customizations: customizationsOf(deployment.customizations),
    includeThinking: deployment.includeThinking,
    includeToolCalls: deployment.includeToolCalls,
  }
}

/** Workflow `workflowId`'s deployment, or `null` when it is not deployed. */
export async function readDeployment(
  ctx: SourceContext,
  workflowId: string
): Promise<StoredDeployment | null> {
  const status = await readWorkflowDeploymentStatus.execute({
    principal: ctx.principal,
    input: { workflowId },
  })
  if (!status.isDeployed) return null
  return {
    isPublicApi: status.workflow.isPublicApi,
    needsRedeployment: status.needsRedeployment,
    chat: await readChat(ctx, workflowId),
  }
}

/**
 * How a stored deployment reads as a declaration. A password reads as the variable the last apply
 * set it from (`passwordEnv`, which the base records, since the server keeps only the encrypted
 * value), else as `stored()`. `null` when a chat output names a block the draft no longer has, or
 * the chat gates access in a way no declaration can name.
 */
export function declOf(
  state: StoredDeployment,
  options: { live: DeploymentDecl['live']; passwordEnv?: string }
): DeploymentDecl | null {
  const decl: DeploymentDecl = { live: options.live }
  if (state.isPublicApi) decl.api = { public: true }
  const { chat } = state
  if (!chat) return decl
  const { authType } = chat
  if (authType === null) return null
  const outputs: NonNullable<ChatDecl['outputs']> = []
  for (const output of chat.outputs) {
    if (output.block === undefined) return null
    outputs.push({ block: output.block, path: output.path })
  }
  decl.chat = {
    identifier: chat.identifier,
    title: chat.title,
    ...(chat.description ? { description: chat.description } : {}),
    auth: authOf(authType, chat.allowedEmails, options.passwordEnv),
    ...(outputs.length > 0 ? { outputs } : {}),
    ...(Object.keys(chat.customizations).length > 0 ? { customizations: chat.customizations } : {}),
    ...(chat.includeThinking ? { includeThinking: true } : {}),
    ...(chat.includeToolCalls ? { includeToolCalls: true } : {}),
  }
  return decl
}

function authOf(
  authType: ChatAuthType,
  allowedEmails: string[],
  passwordEnv: string | undefined
): ChatAuthDecl {
  switch (authType) {
    case 'password':
      return { password: passwordEnv ? { env: passwordEnv } : 'stored' }
    case 'email':
      return { emails: allowedEmails }
    case 'sso':
      return { sso: allowedEmails }
    case 'public':
      return 'public'
  }
}

/**
 * A stored deployment's fingerprint: of the declaration it reads as (`live` is outside every
 * fingerprint). A chat no declaration can name (an output on a block the draft dropped, an auth
 * type source cannot name) fingerprints by its output block ids, so it never equals a declaration.
 */
export function storedFingerprint(
  state: StoredDeployment,
  passwordEnv: string | undefined
): ResourceFingerprint {
  const decl = declOf(state, { live: 'draft', passwordEnv })
  return decl
    ? fingerprintOf(deploymentCodec.canonical(decl))
    : fingerprintOf({ unreadable: state.chat?.outputs.map((output) => output.blockId) ?? [] })
}
