import { parseAsString } from 'nuqs/server'

export const protoParsers = {
  /** Chat open in the slide-in panel next to the project; `new` before the first message. */
  chat: parseAsString.withDefault(''),
  /** Project a new chat starts in; empty means an org-wide chat. */
  project: parseAsString.withDefault(''),
  /** Dashboard shown on the project page: a dashboard file id, `runs`, or a sample id. */
  dashboard: parseAsString.withDefault(''),
  /** First message handed from the home composer to a project's new chat; sent once, then cleared. */
  q: parseAsString.withDefault(''),
}
