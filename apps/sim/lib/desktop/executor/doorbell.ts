import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { createPubSubChannel, type PubSubChannel } from '@/lib/events/pubsub'

const logger = createLogger('DesktopInboxDoorbell')

/** Why a device should re-read its inbox. The event is only a hint; the inbox is the record. */
export type DesktopInboxChangeReason = 'call' | 'approval' | 'cancel'

interface DesktopInboxDoorbell {
  deviceId: string
  reason: DesktopInboxChangeReason
}

type DoorbellGlobal = typeof globalThis & {
  _desktopInboxDoorbell?: PubSubChannel<DesktopInboxDoorbell>
}

/** Opened on first use, so processes that never touch the executor hold no extra connections. */
function channel(): PubSubChannel<DesktopInboxDoorbell> {
  const scope = globalThis as DoorbellGlobal
  scope._desktopInboxDoorbell ??= createPubSubChannel<DesktopInboxDoorbell>({
    channel: 'desktop:inbox',
    label: 'DesktopInboxDoorbell',
  })
  return scope._desktopInboxDoorbell
}

/**
 * Tells every pod serving this device's inbox stream that the inbox changed. Best effort: the
 * ring only hurries the device's next pull, and its periodic reconcile reads the same inbox, so a
 * failed ring is logged and never fails the caller (Stop, a decision, an offer).
 */
export function ringDesktopInbox(deviceId: string, reason: DesktopInboxChangeReason): void {
  try {
    channel().publish({ deviceId, reason })
  } catch (error) {
    logger.warn('Could not ring the desktop inbox', {
      deviceId,
      reason,
      error: toError(error).message,
    })
  }
}

/** Subscribes to one device's doorbell; returns the unsubscribe. */
export function onDesktopInboxDoorbell(
  deviceId: string,
  handler: (reason: DesktopInboxChangeReason) => void
): () => void {
  return channel().subscribe((event) => {
    if (event.deviceId === deviceId) handler(event.reason)
  })
}
