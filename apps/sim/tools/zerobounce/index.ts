export * from './types'

import { getCreditsTool } from '@/tools/zerobounce/get_credits'
import { verifyEmailTool } from '@/tools/zerobounce/verify_email'

export const zerobounceVerifyEmailTool = verifyEmailTool
export const zerobounceGetCreditsTool = getCreditsTool
