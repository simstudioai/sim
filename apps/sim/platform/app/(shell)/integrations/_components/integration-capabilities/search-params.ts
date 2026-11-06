import { parseAsInteger } from 'nuqs/server'

export const catalogParams = {
  'templates-page': parseAsInteger.withDefault(1),
}
