/**
 * Carries the server-resolved deployment shape to the browser on the `<html>`
 * element, so client code never has to rebuild deployment configuration from
 * `NEXT_PUBLIC_*` twins of server variables.
 *
 * The root layout serializes `resolveDeploymentShape()` (see
 * `@/lib/core/config/deployment-shape`) into {@link DEPLOYMENT_SHAPE_ATTRIBUTE}.
 * Like `PUBLIC_ENV_ATTRIBUTE` in `./env`, it rides on the document's first tag,
 * so it is parsed before any script can run: module-scope reads (the
 * better-auth client's plugin list, the `env-flags` constants) see it without a
 * race. What it carries is whatever `resolveDeploymentShape()` returns, so a new
 * shape field is projected by adding it there; nothing here changes. Only
 * browser-safe values belong in the shape: it is readable by any visitor.
 *
 * A document that never ran the root layout (Next's bare `__next_error__` 404
 * shell, or `global-error`) has no attribute; readers then fall back to their
 * own defaults.
 *
 * Imported by `./env-flags`, which `next.config.ts` loads before the `@/` alias
 * exists, so this module uses only relative and workspace-package imports.
 */

import {
  ENTERPRISE_FEATURE_KEYS,
  type EnterpriseFeature,
  type EnterpriseFeatureState,
} from '@sim/deployment-config/enterprise-features'
import { isRegistrationMode, type RegistrationMode } from '@sim/deployment-config/registration'
import { isRecordLike, toRecordOrNull } from '@sim/utils/object'

/** The `<html>` attribute holding the server-resolved deployment shape as JSON. */
export const DEPLOYMENT_SHAPE_ATTRIBUTE = 'data-deployment-shape'

/**
 * The projected deployment shape as untrusted JSON, or `null` on the server and
 * on a document without the attribute. Callers validate the fields they read.
 */
export function readDeploymentProjection(): Record<string, unknown> | null {
  if (typeof document === 'undefined') return null

  const serialized = document.documentElement?.getAttribute(DEPLOYMENT_SHAPE_ATTRIBUTE)
  if (!serialized) return null

  try {
    return toRecordOrNull(JSON.parse(serialized))
  } catch {
    /* A malformed attribute must not take the page down; readers fall back. */
    return null
  }
}

/**
 * The projected enterprise feature state, with any feature the projection does
 * not carry as a boolean taken from `fallback`. `fallback` itself when there is
 * no projection at all.
 */
export function readProjectedEnterpriseFeatures(
  fallback: EnterpriseFeatureState
): EnterpriseFeatureState {
  const features = readDeploymentProjection()?.features
  if (!isRecordLike(features)) return fallback

  const state = {} as Record<EnterpriseFeature, boolean>
  for (const key of ENTERPRISE_FEATURE_KEYS) {
    const value = features[key]
    state[key] = typeof value === 'boolean' ? value : fallback[key]
  }
  return state
}

/**
 * The projected registration mode, or `null` when there is no projection or it
 * does not carry a recognized mode.
 */
export function readProjectedRegistrationMode(): RegistrationMode | null {
  const mode = readDeploymentProjection()?.registrationMode
  return isRegistrationMode(mode) ? mode : null
}
