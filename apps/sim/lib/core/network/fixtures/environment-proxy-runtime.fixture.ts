/** Real runtime probe invoked by environment-proxy.server.test.ts against its local proxy. */
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'

const response = await secureFetchWithValidation(
  'https://1.1.1.1/.well-known/openid-configuration',
  { profile: 'contentFetch', timeout: 10_000 }
)
if (response.headers.get('x-via-proxy') !== 'yes') throw new Error('Guarded fetch bypassed proxy')
if ((await response.text()) !== 'tls reached') throw new Error('Guarded fetch response mismatch')
