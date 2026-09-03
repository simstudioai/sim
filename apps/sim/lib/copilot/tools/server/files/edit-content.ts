import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { executeCopilotFileUseCase } from '@/lib/copilot/application/execute-file-use-case'
import {
  messageForCopilotFileError,
  resolveCopilotFilePrincipal,
} from '@/lib/copilot/auth/file-delegation'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import { isDocSandboxEnabled } from '@/lib/core/config/env-flags'
import { updateWorkspaceFileContent } from '@/lib/workspace-files/application/update-workspace-file-content'
import {
  applyWorkspaceFileContentEdit,
  EditContentError,
  type WorkspaceFileContentEdit,
} from '@/lib/workspace-files/edit-content'
import { MAX_WORKSPACE_FILE_CONTENT_BYTES } from '@/lib/workspace-files/orchestration'
import {
  collectSimPageDiagnostics,
  HAND_WRITTEN_PAGE_MESSAGE,
  isHandWrittenCompiledPage,
  isSimPageSource,
  SIM_PAGE_CONTENT_TYPE,
} from '@/lib/workspace-files/page-compile'
import { getE2BDocFormat } from './doc-compile'
import { buildEmbeddedImageRefWarning } from './embedded-image-refs'
import { waitForLatestFileIntent } from './file-intent-store'
import { compileDocForWrite, getDocumentFormatInfo, inferContentType } from './workspace-file'

const logger = createLogger('EditContentServerTool')

type EditContentArgs = {
  content: string
}

type EditContentResult = {
  success: boolean
  message: string
  data?: Record<string, unknown>
}

export const editContentServerTool: BaseServerTool<EditContentArgs, EditContentResult> = {
  name: 'apply_file_edit',
  async execute(params: EditContentArgs, context?: ServerToolContext): Promise<EditContentResult> {
    if (!context?.userId) {
      logger.error('Unauthorized attempt to use apply_file_edit')
      throw new Error('Authentication required')
    }

    const workspaceId = context.workspaceId
    if (!workspaceId) {
      return { success: false, message: 'Workspace ID is required' }
    }

    const raw = params as Record<string, unknown>
    const nested = raw.args as Record<string, unknown> | undefined
    const content =
      typeof params.content === 'string'
        ? params.content
        : typeof nested?.content === 'string'
          ? (nested.content as string)
          : undefined

    if (content === undefined) {
      return { success: false, message: 'content is required for apply_file_edit' }
    }

    // Consume the intent from THIS file subagent's channel (its outer tool_use
    // id), not just the latest in the message — otherwise two file agents
    // writing concurrently would each grab whichever prepare_file_edit landed last
    // and write their content into the wrong file. Falls back to latest-in-
    // message when no channel id is present (main-agent / legacy calls).
    // Waits briefly: a prepare batched into the same round may still be running.
    const intent = await waitForLatestFileIntent(workspaceId, {
      chatId: context.chatId,
      messageId: context.messageId,
      channelId: context.parentToolCallId,
    })
    if (!intent) {
      return {
        success: false,
        message:
          'No prepare_file_edit context found. Call prepare_file_edit first, wait for it to succeed, then call apply_file_edit in the next step. Do not emit apply_file_edit in parallel or in the same batch as prepare_file_edit.',
      }
    }

    try {
      const { operation, fileRecord } = intent
      const docInfo = getDocumentFormatInfo(fileRecord.name)
      const e2bFmt = isDocSandboxEnabled ? await getE2BDocFormat(fileRecord.name) : null
      // Agent-authored pages are stored as SOURCE (frontmatter + markdown +
      // sim: fences) and compiled to the docs-styled document at render time
      // — the pdf model: the file holds the source, the preview/share/
      // download surfaces serve the rendered version. Bespoke raw HTML
      // passes through, but a hand-written copy of compiled output defeats
      // the source format, so it is rejected with the steer back to source.
      // Patches are exempt: small in-place fixes on a legacy stored-compiled
      // page legitimately contain compiled fragments.
      // Sim pages store an extensionless name; the record type marks them.
      const isHtmlTarget =
        fileRecord.name.toLowerCase().endsWith('.html') || fileRecord.type === SIM_PAGE_CONTENT_TYPE
      if (
        isHtmlTarget &&
        (operation === 'append' || operation === 'update') &&
        isHandWrittenCompiledPage(content)
      ) {
        return { success: false, message: HAND_WRITTEN_PAGE_MESSAGE }
      }

      let finalContent: string
      switch (operation) {
        case 'append': {
          const existing = intent.existingContent ?? ''
          if (isHtmlTarget) {
            finalContent = existing ? `${existing}\n${content}` : content
            break
          }
          // The JS engines (isolated-vm and E2B-node pptx/docx) use the `{ ... }`
          // block-append convention — block statements scope cleanly inside the
          // compile wrapper. Python docs (pdf/xlsx) are a single cohesive script,
          // so brace-wrapping would produce invalid Python; plain-concatenate.
          // Brace-wrap appended content for the JS engines (isolated-vm and
          // E2B-node pptx/docx); Python docs (pdf/xlsx) are one cohesive script.
          const braceWrap = e2bFmt ? e2bFmt.engine === 'node' : docInfo.isDoc
          finalContent = braceWrap
            ? existing
              ? `${existing}\n{\n${content}\n}`
              : content
            : existing
              ? `${existing}\n${content}`
              : content
          break
        }
        case 'update': {
          finalContent = content
          break
        }
        case 'patch': {
          const existing = intent.existingContent ?? ''
          if (!intent.edit) {
            return { success: false, message: 'Patch intent missing edit metadata' }
          }

          let edit: WorkspaceFileContentEdit
          if (intent.edit.strategy === 'search_replace') {
            if (!intent.edit.search) {
              return {
                success: false,
                message: 'search_replace requires search',
              }
            }
            edit = {
              mode: 'search_replace',
              search: intent.edit.search,
              content,
              replaceAll: intent.edit.replaceAll,
            }
          } else if (intent.edit.strategy === 'anchored') {
            if (intent.edit.mode === 'replace_between') {
              if (!intent.edit.before_anchor || !intent.edit.after_anchor) {
                return {
                  success: false,
                  message: 'replace_between requires before_anchor and after_anchor',
                }
              }
              edit = {
                mode: 'replace_between',
                beforeAnchor: intent.edit.before_anchor,
                afterAnchor: intent.edit.after_anchor,
                content,
                occurrence: intent.edit.occurrence,
              }
            } else if (intent.edit.mode === 'insert_after') {
              if (!intent.edit.anchor) {
                return { success: false, message: 'insert_after requires anchor' }
              }
              edit = {
                mode: 'insert_after',
                anchor: intent.edit.anchor,
                content,
                occurrence: intent.edit.occurrence,
              }
            } else if (intent.edit.mode === 'delete_between') {
              if (!intent.edit.start_anchor || !intent.edit.end_anchor) {
                return {
                  success: false,
                  message: 'delete_between requires start_anchor and end_anchor',
                }
              }
              edit = {
                mode: 'delete_between',
                startAnchor: intent.edit.start_anchor,
                endAnchor: intent.edit.end_anchor,
                occurrence: intent.edit.occurrence,
              }
            } else {
              return {
                success: false,
                message: `Unknown anchored patch mode: "${intent.edit.mode}"`,
              }
            }
          } else {
            return { success: false, message: `Unknown patch strategy: "${intent.edit.strategy}"` }
          }
          try {
            finalContent = applyWorkspaceFileContentEdit(existing, edit, {
              maxOutputBytes: MAX_WORKSPACE_FILE_CONTENT_BYTES,
            })
          } catch (error) {
            if (error instanceof EditContentError) {
              return {
                success: false,
                message: `Patch failed for "${fileRecord.name}": ${error.message}`,
              }
            }
            throw error
          }
          break
        }
        default:
          return { success: false, message: `Unsupported operation in intent: ${operation}` }
      }

      // Compile once via the right engine (or isolated-vm fallback) and resolve
      // the source MIME to store. Shared with the create path.
      const principal = resolveCopilotFilePrincipal(context)
      const compiled = await compileDocForWrite({
        source: finalContent,
        fileName: fileRecord.name,
        workspaceId,
        principal,
        ownerKey: `user:${context.userId}`,
        signal: context.abortSignal,
        fallbackMime: inferContentType(fileRecord.name, intent.contentType),
      })
      if (!compiled.ok) {
        return { success: false, message: compiled.message }
      }

      // The internal page type: the record advertises what the .html holds so
      // surfaces can force the rendered view before content loads. The file
      // itself stays .html (serve/download emit text/html).
      // create_empty_file stamps copilot .html as a page by default; the
      // first real content confirms or corrects that from what was written.
      const storedContentType =
        isHtmlTarget && isSimPageSource(finalContent) ? SIM_PAGE_CONTENT_TYPE : compiled.sourceMime

      const fileBuffer = Buffer.from(finalContent, 'utf-8')
      assertServerToolNotAborted(context)
      // `updateWorkspaceFileContent` also streams this edit into any open collaborative editor as a live
      // CRDT merge (gated to markdown, best-effort) — the shared chokepoint every external write path
      // goes through — so a copilot edit shows up live instead of the file changing under the reader.
      await executeCopilotFileUseCase(
        context,
        updateWorkspaceFileContent,
        {
          fileId: intent.fileId,
          assertedWorkspaceId: workspaceId,
          content: finalContent,
          encoding: 'utf-8',
          contentType: storedContentType,
          provenanceMode: operation === 'update' ? 'replace_empty' : 'preserve',
        },
        { fileId: intent.fileId }
      )

      const verb =
        operation === 'append' ? 'appended to' : operation === 'update' ? 'updated' : 'patched'
      logger.info(`Workspace file ${verb} via copilot (apply_file_edit)`, {
        fileId: intent.fileId,
        name: fileRecord.name,
        operation,
        size: fileBuffer.length,
        userId: context.userId,
      })

      // Flag any `/api/files/view/<id>` embeds the model just authored that won't render/export
      // (non-workspace or missing), so it can self-correct on the next step.
      const embedWarning = await buildEmbeddedImageRefWarning(content, workspaceId)

      // Page-source lint: a malformed sim: block renders as NOTHING for the
      // reader — the only place the failure surfaces is right here, so the
      // agent can fix the fence instead of shipping a silent hole.
      let pageLint = ''
      if (storedContentType === SIM_PAGE_CONTENT_TYPE) {
        const diagnostics = collectSimPageDiagnostics(finalContent)
        if (diagnostics.length > 0) {
          pageLint = ` WARNING — ${diagnostics.length} block(s) failed to compile and are OMITTED from the rendered page; fix them: ${diagnostics.join('; ')}`
        }
      }

      return {
        success: true,
        message: `File "${fileRecord.name}" ${verb} successfully (${fileBuffer.length} bytes)${embedWarning}${pageLint}`,
        data: {
          id: intent.fileId,
          name: fileRecord.name,
          size: fileBuffer.length,
          contentType: storedContentType,
        },
      }
    } catch (error) {
      const safeMessage = messageForCopilotFileError(error, 'Failed to edit file content')
      const errorMessage = getErrorMessage(error, 'Unknown error occurred')
      logger.error('Error in apply_file_edit tool', {
        operation: intent.operation,
        fileId: intent.fileId,
        error: errorMessage,
        userId: context.userId,
      })
      return {
        success: false,
        message: safeMessage,
      }
    }
  },
}
