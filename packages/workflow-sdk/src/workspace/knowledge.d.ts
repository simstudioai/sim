/**
 * Knowledge base declarations: `knowledge/<key>/knowledge.ts` in a workspace source directory,
 * beside `knowledge/<key>/docs/`, which holds one file per document.
 *
 * ```ts
 * // @sim-sdk 1
 * import { defineKnowledgeBase } from '@sim/workflow-sdk/workspace'
 *
 * export default defineKnowledgeBase({
 *   name: 'Policies',
 *   description: 'Refund and shipping policies',
 *   chunking: { maxSize: 1024, minSize: 100, overlap: 200 },
 * })
 * ```
 *
 * Documents sync by content: adding a file to `docs/` uploads it, editing one replaces the stored
 * document (a new upload that takes the old one's tag values), and removing one deletes it only with
 * `--allow-delete`. Every uploaded or replaced document is indexed after the apply. Documents a
 * connector syncs are never part of source.
 */

/** How documents are split into chunks before they are embedded. */
export interface KnowledgeChunking {
  /** Largest chunk, in tokens (100–4000; 1024 when omitted). */
  maxSize?: number
  /** Smallest chunk, in characters (1–2000; 100 when omitted). */
  minSize?: number
  /** Tokens neighbouring chunks share (0–500; 200 when omitted). */
  overlap?: number
  strategy?: 'auto' | 'text' | 'regex' | 'recursive' | 'sentence' | 'token'
  strategyOptions?: {
    /** The split pattern of the `regex` strategy. */
    pattern?: string
    separators?: string[]
    recipe?: 'plain' | 'markdown' | 'code'
    /** `regex` only: every match is its own chunk. */
    strictBoundaries?: boolean
  }
}

/** A knowledge base declaration. */
export interface KnowledgeBaseDeclaration {
  name: string
  description?: string
  /** The knowledge base folder path (`/support`); the workspace root when omitted. */
  folder?: string
  /**
   * Applies to documents indexed from now on; stored chunks keep the settings they were made
   * with.
   */
  chunking?: KnowledgeChunking
  /** The embedding model, fixed when the knowledge base is created. */
  embeddingModel?: string
}

/** Declares a knowledge base. Its default export is the whole file. */
export declare function defineKnowledgeBase(
  knowledgeBase: KnowledgeBaseDeclaration
): KnowledgeBaseDeclaration
