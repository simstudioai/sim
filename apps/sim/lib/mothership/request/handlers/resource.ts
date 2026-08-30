import type { StreamHandler } from './types'

export const handleResourceEvent: StreamHandler = (event) => {
  if (event.type !== 'resource') {
    return
  }
}
