import 'server-only'
import { PUBLIC_ENV_ATTRIBUTE } from '@/lib/core/config/env'
import { publicEnvHtmlAttributes } from '@/lib/core/config/public-env'

/**
 * The `NEXT_PUBLIC_*` snapshot for `<html>`, which the shared auth client and URL helpers read in
 * the browser. A live session needs it; the image is built with placeholder values.
 */
export function readPublicEnvAttribute(): string {
  return publicEnvHtmlAttributes()[PUBLIC_ENV_ATTRIBUTE]
}
