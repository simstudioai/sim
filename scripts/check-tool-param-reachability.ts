#!/usr/bin/env bun
/**
 * Fails when a tool declares a required parameter nothing can fill.
 *
 * `visibility: 'hidden'` means "not shown to user or LLM" (`tools/types.ts`), so
 * a hidden parameter has no caller. Something else has to supply it, and only
 * two mechanisms do: OAuth credential resolution, which assigns the fields in
 * {@link CREDENTIAL_FILLED} once a credential is bound, and hosted-key
 * injection, which assigns `hosting.apiKeyParam`. A required hidden parameter
 * outside both is unreachable by every caller except the block that happens to
 * construct it during serialization.
 *
 * The failure this exists to prevent is silent. `createUserToolSchema` omits
 * hidden parameters, so an agent is never told to send one; a tool that also
 * omits its `oauth` declaration is never asked for a credential either; and
 * `validateRequiredParametersAfterMerge` only validates `user-or-llm`, so
 * nothing rejects the call. The request is built with `undefined` in place of
 * the value and the provider answers a 401 that names nothing — which is how
 * 117 parameters across four integrations reached production broken for every
 * direct caller (Copilot's `call_integration_tool` and `POST
 * /api/v2/tools/{toolId}/execute`) while working inside a workflow.
 *
 * The fix is one of three, decided by what actually supplies the value:
 *
 *   - the user types it into a block field  ->  `visibility: 'user-only'`
 *     (`mailchimp.apiKey`, `zendesk.apiToken`). This does not widen what the
 *     model sees: `createLLMToolSchema` skips `user-only` and `hidden` alike.
 *     It only lets a caller send it, and lets `{{VAR}}` references resolve.
 *   - a bound OAuth credential supplies it  ->  declare `oauth` on the tool
 *     (`pipedrive`, `wealthbox`, whose `accessToken: 'hidden'` was already
 *     right; the missing declaration was the bug).
 *   - a block composes it from sibling fields  ->  publish the composed shape as
 *     `visibility: 'user-or-llm'` (`calcom_create_booking.attendee`). The block
 *     keeps composing it — `tools.config.params` runs before execution, so the
 *     merge validation still sees a value — and a direct caller sends the object
 *     itself.
 *
 * Choosing `user-only` carries an obligation: `check-block-registry.ts` requires
 * every required `user-only` parameter to have a subBlock whose `id` or
 * `canonicalParamId` equals the parameter id, because the serializer resolves it
 * by direct lookup. A block whose canonical key differs has to be aligned on the
 * parameter id — safe to do, because canonical ids are config-derived rather
 * than stored, and `backfillCanonicalModes` re-derives a renamed pair's mode
 * from whichever value is populated.
 *
 * There is deliberately no allowlist. All three answers leave the parameter
 * reachable, so a parameter needing an exemption is one no caller can supply —
 * exactly what this audit exists to reject.
 *
 * Usage:
 *   bun run scripts/check-tool-param-reachability.ts
 */
import { tools } from '../apps/sim/tools/registry'
import type { ToolConfig } from '../apps/sim/tools/types'

/**
 * Parameters `executeToolImplementation` assigns from a resolved credential.
 *
 * Kept in step with the assignments in `apps/sim/tools/index.ts` — a tool
 * declaring `oauth` earns an exemption only for the fields the resolver
 * actually writes, so a hidden parameter with an unrelated name is still
 * reported even on an OAuth tool.
 */
const CREDENTIAL_FILLED = new Set([
  'accessToken',
  'idToken',
  'instanceUrl',
  'apiDomain',
  'cloudId',
  'domain',
  'authStyle',
])

/**
 * `credentialType` is the one credential field the resolver gates on more than
 * the credential carrying it: it is assigned only when the tool lists it in
 * `oauth.authoritativeParams`. Exempting it unconditionally would pass a future
 * required-hidden `credentialType` that execution leaves `undefined`.
 */
const AUTHORITATIVE_ONLY = 'credentialType'

interface Finding {
  toolId: string
  param: string
  reason: string
}

function findUnreachableParams(): Finding[] {
  const findings: Finding[] = []

  for (const [toolId, config] of Object.entries(tools as Record<string, ToolConfig>)) {
    /**
     * Only unconditional hosting is a guarantee. A `hosting.enabled` predicate
     * can decline for a given parameter combination, and this audit has no
     * params to evaluate it against — so a conditionally-hosted key is treated
     * as unfilled, which is the answer that fails closed.
     */
    const hostedKeyParam = config.hosting?.enabled ? undefined : config.hosting?.apiKeyParam

    for (const [param, declaration] of Object.entries(config.params ?? {})) {
      if (!declaration || declaration.visibility !== 'hidden' || !declaration.required) continue
      if (config.oauth && CREDENTIAL_FILLED.has(param)) continue
      if (
        config.oauth &&
        param === AUTHORITATIVE_ONLY &&
        config.oauth.authoritativeParams?.includes(AUTHORITATIVE_ONLY)
      ) {
        continue
      }
      if (hostedKeyParam && param === hostedKeyParam) continue

      findings.push({
        toolId,
        param,
        reason: config.oauth
          ? `declares oauth (${config.oauth.provider}), which does not supply '${param}'`
          : config.hosting?.enabled
            ? `hosting is conditional, so it is not a guarantee for '${param}'`
            : config.hosting
              ? `hosting supplies '${config.hosting.apiKeyParam}', not '${param}'`
              : 'declares neither oauth nor hosting',
      })
    }
  }

  return findings.sort((a, b) => a.toolId.localeCompare(b.toolId) || a.param.localeCompare(b.param))
}

function main(): void {
  const findings = findUnreachableParams()
  const toolCount = Object.keys(tools).length

  if (findings.length === 0) {
    console.log(
      `✓ tool parameter reachability: all ${toolCount} tools supply every required hidden parameter through oauth, hosting, or a published shape`
    )
    return
  }

  console.error('Tool parameter reachability audit failed:\n')
  for (const { toolId, param, reason } of findings) {
    console.error(`  ${toolId} — required hidden parameter '${param}': ${reason}`)
  }
  console.error(
    [
      '',
      'A required hidden parameter has no caller. Supply it by declaration, not by hoping:',
      "  - the user types it into a block field  ->  visibility: 'user-only'",
      '  - a bound OAuth credential supplies it  ->  declare oauth on the tool',
      "  - Sim's hosted key supplies it          ->  declare hosting with this apiKeyParam",
      "  - a block composes it from siblings     ->  publish the shape as 'user-or-llm'",
      '',
      'Leaving it hidden means every direct caller sends undefined and reads an',
      'upstream 401 that names nothing, while the block path keeps working — so the',
      'break is invisible until someone calls the tool outside a workflow.',
    ].join('\n')
  )
  process.exit(1)
}

main()
