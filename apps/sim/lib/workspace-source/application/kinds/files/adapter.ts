import { fileCodec } from '@sim/workspace-code/kinds/files'
import { unsupportedAdapter } from '@/lib/workspace-source/application/kinds/unsupported'

/** Workspace files: not supported yet (phase 2 replaces this file with the real adapter). */
export const fileAdapter = unsupportedAdapter(fileCodec)
