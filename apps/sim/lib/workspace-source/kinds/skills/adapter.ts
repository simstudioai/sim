import { skillCodec } from '@sim/workspace-code/kinds/skills'
import { unsupportedAdapter } from '@/lib/workspace-source/kinds/unsupported'

/** Skills: not supported yet (phase 2 replaces this file with the real adapter). */
export const skillAdapter = unsupportedAdapter(skillCodec)
