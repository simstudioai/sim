import type { JSONContent } from '@tiptap/core'
import { parseMarkdownToDoc } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-parse'

/**
 * Installs the minimal DOM globals needed by the canonical TipTap Markdown engine in a server
 * process. The single jsdom window is reused for every parse/serialize call in that process.
 */
export function ensureServerMarkdownDom(): void {
  if (typeof window !== 'undefined' && typeof document !== 'undefined') return
  const { JSDOM } = require('jsdom') as typeof import('jsdom')
  const { window: jsdomWindow } = new JSDOM('<!doctype html><html><body></body></html>')
  const globals = globalThis as unknown as Record<string, unknown>
  globals.window = jsdomWindow
  globals.document = jsdomWindow.document
  globals.navigator ??= jsdomWindow.navigator
}

/** Parse Markdown with the exact extension set and schema used by the Files editor. */
export function parseServerMarkdownToDoc(markdown: string): JSONContent {
  ensureServerMarkdownDom()
  return parseMarkdownToDoc(markdown)
}
