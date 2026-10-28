import { registerDesktopDeviceContract } from '@/lib/api/contracts/desktop-executor'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { desktopExecutorErrorPolicy } from '@/lib/api/server/routes/desktop-executor'
import { registerDesktopDevice } from '@/lib/desktop/application/executor'

export const POST = defineInternalJsonRoute({
  contract: registerDesktopDeviceContract,
  auth: internalSessionAuth,
  operation: registerDesktopDevice.operation,
  rateLimit: internalRateLimits.user({ bucketName: 'desktop-device-register' }),
  errorPolicy: desktopExecutorErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: registerDesktopDevice,
  staticResponseHeaders: { 'Cache-Control': 'no-store' },
})
