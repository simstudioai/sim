import { knowledgeCodec } from '@sim/workspace-code/kinds/knowledge'
import { unsupportedAdapter } from '@/lib/workspace-source/kinds/unsupported'

/** Knowledge bases: not supported yet (phase 2 replaces this file with the real adapter). */
export const knowledgeAdapter = unsupportedAdapter(knowledgeCodec)
