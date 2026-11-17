import { toolCodec } from '@sim/workspace-code/kinds/tools'
import { unsupportedAdapter } from '@/lib/workspace-source/application/kinds/unsupported'

/** Custom tools: not supported yet (phase 2 replaces this file with the real adapter). */
export const toolAdapter = unsupportedAdapter(toolCodec)
