import { getConsentTool } from '@/tools/ketch/get_consent'
import { getSubscriptionsTool } from '@/tools/ketch/get_subscriptions'
import { invokeRightTool } from '@/tools/ketch/invoke_right'
import { setConsentTool } from '@/tools/ketch/set_consent'
import { setSubscriptionsTool } from '@/tools/ketch/set_subscriptions'

export const ketchGetConsentTool = getConsentTool
export const ketchSetConsentTool = setConsentTool
export const ketchInvokeRightTool = invokeRightTool
export const ketchGetSubscriptionsTool = getSubscriptionsTool
export const ketchSetSubscriptionsTool = setSubscriptionsTool
