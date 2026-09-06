/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { v2FileSchema } from '@/lib/api/contracts/v2/files'
import { ANONYMOUS_USER } from '@/lib/auth/constants'

describe('file uploader attribution', () => {
  it.each([ANONYMOUS_USER.email, 'ada@example.com', 'ada+files@example.co.uk'])(
    'preserves the stored uploader email %s',
    (email) => {
      expect(v2FileSchema.shape.uploadedByEmail.parse(email)).toBe(email)
    }
  )

  it.each(['', 'not-an-email', 'ada@', '@example.com', 'ada @example.com', 'ada@example..com'])(
    'rejects malformed attribution %s',
    (email) => {
      expect(v2FileSchema.shape.uploadedByEmail.safeParse(email).success).toBe(false)
    }
  )
})
