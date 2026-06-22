import { parseAsStringLiteral } from 'nuqs/server'
import {
  CONNECT_MODE,
  CONNECT_QUERY_PARAM,
} from '@/app/workspace/[workspaceId]/integrations/connect-route'

const CONNECT_MODE_VALUES = [CONNECT_MODE.oauth, CONNECT_MODE.serviceAccount] as const

/**
 * Typed parser for the ephemeral `?connect=oauth|service-account` deep-link on
 * the integration detail page. The param is read once to pre-open the matching
 * connect modal, then stripped from the URL.
 */
export const connectParam = {
  key: CONNECT_QUERY_PARAM,
  parser: parseAsStringLiteral(CONNECT_MODE_VALUES),
} as const
