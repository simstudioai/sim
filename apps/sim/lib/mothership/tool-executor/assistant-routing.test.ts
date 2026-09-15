/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { hasHandler } from '@/lib/mothership/tool-executor/executor'
import { ensureHandlersRegistered } from '@/lib/mothership/tool-executor/register-handlers'
import { getToolEntry, isSimExecuted } from '@/lib/mothership/tool-executor/router'

describe('retained Assistant Sim executors', () => {
  it.each(['search_workspace', 'read_document', 'oauth_get_auth_link'])(
    'registers the canonical %s executor',
    (id) => {
      ensureHandlersRegistered()
      expect(getToolEntry(id)?.route).toBe('sim')
      expect(isSimExecuted(id)).toBe(true)
      expect(hasHandler(id)).toBe(true)
    }
  )
})
