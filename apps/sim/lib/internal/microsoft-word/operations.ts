import { createLogger } from '@sim/logger'
import {
  downloadConvertedContent,
  downloadDocumentContent,
  fetchDocumentItem,
  replaceContentIfUnchanged,
  requireContentTag,
  toDocumentMetadata,
  uploadDocumentContent,
} from '@/lib/internal/microsoft-word/client'
import type {
  MicrosoftWordAppendInput,
  MicrosoftWordCreateFromTemplateInput,
  MicrosoftWordCreateInput,
  MicrosoftWordExportPdfInput,
  MicrosoftWordReadInput,
  MicrosoftWordReplaceTextInput,
  MicrosoftWordUpdateInput,
} from '@/lib/internal/microsoft-word/schema'
import {
  appendParagraphsToDocx,
  buildDocxFromContent,
  DOCX_MIME_TYPE,
  extractDocxText,
  parseReplacements,
  replaceTextInDocx,
} from '@/lib/microsoft-word/document.server'
import {
  buildCreateUploadUrl,
  ensureDocxExtension,
  getDocumentBasePath,
  getDriveBasePath,
  getFolderBasePath,
} from '@/tools/microsoft_word/utils'

const logger = createLogger('MicrosoftWordOperations')
const PDF_MIME_TYPE = 'application/pdf'

export interface MicrosoftWordOperationContext {
  requestId: string
  signal?: AbortSignal
}

function throwIfAborted(context: MicrosoftWordOperationContext): void {
  context.signal?.throwIfAborted()
}

/** Creates a new Word document without replacing a same-named drive item. */
export async function executeMicrosoftWordCreate(
  input: MicrosoftWordCreateInput,
  context: MicrosoftWordOperationContext
) {
  throwIfAborted(context)
  const fileName = ensureDocxExtension(input.name)
  const parentPath = input.folderId?.trim()
    ? getFolderBasePath(input.folderId, input.driveId ?? undefined)
    : `${getDriveBasePath(input.driveId ?? undefined)}/root`
  const uploadUrl = buildCreateUploadUrl(parentPath, fileName)
  const documentBuffer = await buildDocxFromContent(input.content ?? '', input.name)
  throwIfAborted(context)
  const item = await uploadDocumentContent(
    uploadUrl,
    input.accessToken,
    documentBuffer,
    DOCX_MIME_TYPE,
    context.signal
  )
  throwIfAborted(context)

  logger.info('Created Word document', {
    requestId: context.requestId,
    documentId: item.id,
    size: item.size,
  })
  return {
    success: true as const,
    output: { metadata: toDocumentMetadata(item, item.id ?? '') },
  }
}

/** Reads the text and metadata of an existing Word document. */
export async function executeMicrosoftWordRead(
  input: MicrosoftWordReadInput,
  context: MicrosoftWordOperationContext
) {
  throwIfAborted(context)
  const basePath = getDocumentBasePath(input.documentId, input.driveId ?? undefined)
  const item = await fetchDocumentItem(basePath, input.accessToken, context.signal)
  const documentBuffer = await downloadDocumentContent(basePath, input.accessToken, context.signal)
  throwIfAborted(context)
  const content = await extractDocxText(documentBuffer)
  throwIfAborted(context)

  logger.info('Read Word document', {
    requestId: context.requestId,
    documentId: input.documentId,
    characterCount: content.length,
  })
  return {
    success: true as const,
    output: { content, metadata: toDocumentMetadata(item, input.documentId) },
  }
}

/** Deliberately replaces all content in an existing Word document. */
export async function executeMicrosoftWordUpdate(
  input: MicrosoftWordUpdateInput,
  context: MicrosoftWordOperationContext
) {
  throwIfAborted(context)
  const basePath = getDocumentBasePath(input.documentId, input.driveId ?? undefined)
  const existing = await fetchDocumentItem(basePath, input.accessToken, context.signal)
  throwIfAborted(context)
  const documentBuffer = await buildDocxFromContent(input.content, existing.name)
  throwIfAborted(context)
  const item = await uploadDocumentContent(
    `${basePath}/content`,
    input.accessToken,
    documentBuffer,
    DOCX_MIME_TYPE,
    context.signal
  )
  throwIfAborted(context)

  logger.info('Replaced Word document contents', {
    requestId: context.requestId,
    documentId: input.documentId,
    size: item.size,
  })
  return {
    success: true as const,
    output: {
      updatedContent: true,
      metadata: toDocumentMetadata(item, input.documentId),
    },
  }
}

/** Appends paragraphs while preserving the rest of the document package. */
export async function executeMicrosoftWordAppend(
  input: MicrosoftWordAppendInput,
  context: MicrosoftWordOperationContext
) {
  throwIfAborted(context)
  const basePath = getDocumentBasePath(input.documentId, input.driveId ?? undefined)
  const existingItem = await fetchDocumentItem(basePath, input.accessToken, context.signal)
  const contentTag = requireContentTag(existingItem)
  const existingBuffer = await downloadDocumentContent(basePath, input.accessToken, context.signal)
  throwIfAborted(context)
  const { buffer, paragraphsAppended } = await appendParagraphsToDocx(existingBuffer, input.content)
  throwIfAborted(context)

  if (paragraphsAppended === 0) {
    logger.info('No paragraphs to append; document left untouched', {
      requestId: context.requestId,
      documentId: input.documentId,
    })
    return {
      success: true as const,
      output: {
        updatedContent: false,
        metadata: toDocumentMetadata(existingItem, input.documentId),
      },
    }
  }

  const item = await replaceContentIfUnchanged(
    basePath,
    input.accessToken,
    buffer,
    contentTag,
    context.signal
  )
  throwIfAborted(context)
  logger.info('Appended to Word document', {
    requestId: context.requestId,
    documentId: input.documentId,
    paragraphsAppended,
    size: item.size,
  })
  return {
    success: true as const,
    output: {
      updatedContent: true,
      metadata: toDocumentMetadata(item, input.documentId),
    },
  }
}

/** Creates a new document by filling an existing Word template. */
export async function executeMicrosoftWordCreateFromTemplate(
  input: MicrosoftWordCreateFromTemplateInput,
  context: MicrosoftWordOperationContext
) {
  throwIfAborted(context)
  const templatePath = getDocumentBasePath(input.templateDocumentId, input.driveId ?? undefined)
  await fetchDocumentItem(templatePath, input.accessToken, context.signal)
  const templateBuffer = await downloadDocumentContent(
    templatePath,
    input.accessToken,
    context.signal
  )
  throwIfAborted(context)
  const pairs = parseReplacements(input.replacements)
  const filled =
    pairs.length > 0
      ? await replaceTextInDocx(templateBuffer, pairs, input.matchCase ?? false)
      : { buffer: templateBuffer, occurrencesChanged: 0 }
  throwIfAborted(context)

  const fileName = ensureDocxExtension(input.name)
  const parentPath = input.folderId?.trim()
    ? getFolderBasePath(input.folderId, input.driveId ?? undefined)
    : `${getDriveBasePath(input.driveId ?? undefined)}/root`
  const uploadUrl = buildCreateUploadUrl(parentPath, fileName)
  const item = await uploadDocumentContent(
    uploadUrl,
    input.accessToken,
    filled.buffer,
    DOCX_MIME_TYPE,
    context.signal
  )
  throwIfAborted(context)

  logger.info('Created Word document from template', {
    requestId: context.requestId,
    templateDocumentId: input.templateDocumentId,
    documentId: item.id,
    occurrencesChanged: filled.occurrencesChanged,
  })
  return {
    success: true as const,
    output: {
      occurrencesChanged: filled.occurrencesChanged,
      metadata: toDocumentMetadata(item, item.id ?? ''),
    },
  }
}

/** Replaces matching text without rewriting an unchanged document. */
export async function executeMicrosoftWordReplaceText(
  input: MicrosoftWordReplaceTextInput,
  context: MicrosoftWordOperationContext
) {
  throwIfAborted(context)
  const basePath = getDocumentBasePath(input.documentId, input.driveId ?? undefined)
  const existingItem = await fetchDocumentItem(basePath, input.accessToken, context.signal)
  const contentTag = requireContentTag(existingItem)
  const existingBuffer = await downloadDocumentContent(basePath, input.accessToken, context.signal)
  throwIfAborted(context)
  const { buffer, occurrencesChanged } = await replaceTextInDocx(
    existingBuffer,
    [{ find: input.findText, replace: input.replaceText ?? '' }],
    input.matchCase ?? false
  )
  throwIfAborted(context)

  if (occurrencesChanged === 0) {
    logger.info('No occurrences matched; document left untouched', {
      requestId: context.requestId,
      documentId: input.documentId,
    })
    return {
      success: true as const,
      output: {
        occurrencesChanged: 0,
        metadata: toDocumentMetadata(existingItem, input.documentId),
      },
    }
  }

  const item = await replaceContentIfUnchanged(
    basePath,
    input.accessToken,
    buffer,
    contentTag,
    context.signal
  )
  throwIfAborted(context)
  logger.info('Replaced text in Word document', {
    requestId: context.requestId,
    documentId: input.documentId,
    occurrencesChanged,
  })
  return {
    success: true as const,
    output: {
      occurrencesChanged,
      metadata: toDocumentMetadata(item, input.documentId),
    },
  }
}

function resolvePdfName(override: string | null | undefined, documentName?: string): string {
  const explicit = override?.trim()
  if (explicit) return explicit.toLowerCase().endsWith('.pdf') ? explicit : `${explicit}.pdf`

  const base = documentName?.trim().replace(/\.docx$/i, '')
  return base ? `${base}.pdf` : 'document.pdf'
}

/** Converts a Word document to a PDF file output through Microsoft Graph. */
export async function executeMicrosoftWordExportPdf(
  input: MicrosoftWordExportPdfInput,
  context: MicrosoftWordOperationContext
) {
  throwIfAborted(context)
  const basePath = getDocumentBasePath(input.documentId, input.driveId ?? undefined)
  const item = await fetchDocumentItem(basePath, input.accessToken, context.signal)
  const pdfBuffer = await downloadConvertedContent(
    basePath,
    input.accessToken,
    'pdf',
    context.signal
  )
  throwIfAborted(context)
  const name = resolvePdfName(input.fileName, item.name)

  logger.info('Exported Word document as PDF', {
    requestId: context.requestId,
    documentId: input.documentId,
    name,
    size: pdfBuffer.length,
  })
  return {
    success: true as const,
    output: {
      file: {
        name,
        mimeType: PDF_MIME_TYPE,
        data: pdfBuffer.toString('base64'),
        size: pdfBuffer.length,
      },
    },
  }
}
