import type { BlockLog } from '@/executor/types'

/** A server-projected BlockLog copy carrying presentation-only reconciliation hints. */
export interface SecretSafeBlockLog extends BlockLog {
  clearLiveDisplay?: true
}
