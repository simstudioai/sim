import { db } from '@sim/db'
import { chat, workflow, workflowDeploymentVersion } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'

const logger = createLogger('DeployChatServerTool')

const OutputConfigSchema = z.object({
  blockId: z.string(),
  path: z.string(),
})

export const DeployChatInput = z.object({
  action: z.enum(['deploy', 'undeploy']).default('deploy'),
  workflowId: z.string().min(1),
  identifier: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  authType: z.enum(['public', 'password', 'email', 'sso']).optional().default('public'),
  password: z.string().optional(),
  allowedEmails: z.array(z.string()).optional(),
  welcomeMessage: z.string().optional(),
  outputConfigs: z.array(OutputConfigSchema).optional(),
})

export const DeployChatResult = z.object({
  success: z.boolean(),
  action: z.string(),
  isDeployed: z.boolean(),
  chatId: z.string().nullable(),
  chatUrl: z.string().nullable(),
  identifier: z.string().nullable(),
  title: z.string().nullable(),
  authType: z.string().nullable(),
  message: z.string(),
  error: z.string().optional(),
  errorCode: z.string().optional(),
})

export type DeployChatInputType = z.infer<typeof DeployChatInput>
export type DeployChatResultType = z.infer<typeof DeployChatResult>

function generateIdentifier(workflowName: string): string {
  return workflowName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50)
}

export const deployChatServerTool: BaseServerTool<DeployChatInputType, DeployChatResultType> = {
  name: 'deploy_chat',
  async execute(args: unknown, context?: { userId: string }) {
    const parsed = DeployChatInput.parse(args)
    const { action, workflowId, authType = 'public' } = parsed

    if (!context?.userId) {
      throw new Error('User authentication required')
    }

    logger.debug('Deploy Chat', { action, workflowId })

    // Get workflow info
    const [wf] = await db.select().from(workflow).where(eq(workflow.id, workflowId)).limit(1)

    if (!wf) {
      throw new Error(`Workflow not found: ${workflowId}`)
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    // Check for existing deployment
    const [existingChat] = await db
      .select()
      .from(chat)
      .where(and(eq(chat.workflowId, workflowId), eq(chat.isActive, true)))
      .limit(1)

    if (action === 'undeploy') {
      if (!existingChat) {
        return DeployChatResult.parse({
          success: false,
          action: 'undeploy',
          isDeployed: false,
          chatId: null,
          chatUrl: null,
          identifier: null,
          title: null,
          authType: null,
          message: 'No active chat deployment found for this workflow',
          error: 'No active chat deployment found',
          errorCode: 'VALIDATION_ERROR',
        })
      }

      // Deactivate the chat deployment
      await db.update(chat).set({ isActive: false }).where(eq(chat.id, existingChat.id))

      logger.info('Chat undeployed', { workflowId, chatId: existingChat.id })

      return DeployChatResult.parse({
        success: true,
        action: 'undeploy',
        isDeployed: false,
        chatId: null,
        chatUrl: null,
        identifier: null,
        title: null,
        authType: null,
        message: 'Chat deployment removed successfully.',
      })
    }

    // Deploy action
    const identifier =
      parsed.identifier || existingChat?.identifier || generateIdentifier(wf.name || 'chat')
    const title = parsed.title || existingChat?.title || wf.name || 'Chat'
    const description = parsed.description ?? existingChat?.description ?? ''
    const welcomeMessage =
      parsed.welcomeMessage ||
      (existingChat?.customizations as any)?.welcomeMessage ||
      'Hi there! How can I help you today?'
    const primaryColor =
      (existingChat?.customizations as any)?.primaryColor || 'var(--brand-primary-hover-hex)'
    const existingAllowedEmails = Array.isArray(existingChat?.allowedEmails)
      ? existingChat.allowedEmails
      : []
    const allowedEmails = parsed.allowedEmails || existingAllowedEmails
    const outputConfigs = parsed.outputConfigs || existingChat?.outputConfigs || []

    // Validate requirements
    if (authType === 'password' && !parsed.password && !existingChat?.password) {
      throw new Error('Password is required when using password protection')
    }

    if ((authType === 'email' || authType === 'sso') && allowedEmails.length === 0) {
      throw new Error(`At least one email or domain is required when using ${authType} access`)
    }

    // Check if identifier is already in use by another workflow
    if (!existingChat) {
      const [existingIdentifier] = await db
        .select({ id: chat.id })
        .from(chat)
        .where(and(eq(chat.identifier, identifier), eq(chat.isActive, true)))
        .limit(1)

      if (existingIdentifier) {
        return DeployChatResult.parse({
          success: false,
          action: 'deploy',
          isDeployed: false,
          chatId: null,
          chatUrl: null,
          identifier,
          title: null,
          authType: null,
          message: `The identifier "${identifier}" is already in use. Please choose a different one.`,
          error: `Identifier "${identifier}" is already taken`,
          errorCode: 'IDENTIFIER_TAKEN',
        })
      }
    }

    // Ensure workflow is deployed as API first
    const [deployment] = await db
      .select({ id: workflowDeploymentVersion.id })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, workflowId),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
      .limit(1)

    if (!deployment) {
      // Auto-deploy the API
      const [maxVersion] = await db
        .select({ version: workflowDeploymentVersion.version })
        .from(workflowDeploymentVersion)
        .where(eq(workflowDeploymentVersion.workflowId, workflowId))
        .orderBy(desc(workflowDeploymentVersion.version))
        .limit(1)

      const newVersion = (maxVersion?.version || 0) + 1
      const deploymentId = crypto.randomUUID()
      const now = new Date()

      // Load workflow state from normalized tables
      const normalizedData = await loadWorkflowFromNormalizedTables(workflowId)
      const workflowState = {
        blocks: normalizedData?.blocks || {},
        edges: normalizedData?.edges || [],
        loops: normalizedData?.loops || {},
        parallels: normalizedData?.parallels || {},
      }

      await db.insert(workflowDeploymentVersion).values({
        id: deploymentId,
        workflowId,
        version: newVersion,
        state: workflowState,
        isActive: true,
        createdAt: now,
      })

      logger.info('Auto-deployed API for chat', { workflowId, version: newVersion })
    }

    const now = new Date()
    let chatId: string

    if (existingChat) {
      // Update existing deployment
      await db
        .update(chat)
        .set({
          identifier: identifier.trim(),
          title: title.trim(),
          description: description.trim(),
          authType,
          password: authType === 'password' ? parsed.password || existingChat.password : null,
          allowedEmails: authType === 'email' || authType === 'sso' ? allowedEmails : [],
          customizations: { primaryColor, welcomeMessage: welcomeMessage.trim() },
          outputConfigs,
          updatedAt: now,
        })
        .where(eq(chat.id, existingChat.id))

      chatId = existingChat.id
      logger.info('Updated chat deployment', { chatId })
    } else {
      // Create new deployment
      chatId = crypto.randomUUID()

      await db.insert(chat).values({
        id: chatId,
        workflowId,
        userId: context.userId,
        identifier: identifier.trim(),
        title: title.trim(),
        description: description.trim(),
        authType,
        password: authType === 'password' ? parsed.password : null,
        allowedEmails: authType === 'email' || authType === 'sso' ? allowedEmails : [],
        customizations: { primaryColor, welcomeMessage: welcomeMessage.trim() },
        outputConfigs,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })

      logger.info('Created chat deployment', { chatId })
    }

    const chatUrl = `${appUrl}/chat/${identifier}`

    return DeployChatResult.parse({
      success: true,
      action: 'deploy',
      isDeployed: true,
      chatId,
      chatUrl,
      identifier,
      title,
      authType,
      message: `Chat deployed successfully! Available at: ${chatUrl}`,
    })
  },
}
