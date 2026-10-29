# Self-hosted: OAuth tokens sealed at rest

Status: editorial draft. Availability and media require review before an article is added.

## Editorial selection

Story type: action_required

PR #9425 introduces encrypted-at-rest OAuth token storage for self-hosted Sim, enabled by default when ENCRYPTION_KEY is 64 hex characters, with a hard rollback restriction below v0.9.33. This is a clear action_required story: the feature activates automatically with a valid key and imposes an irreversible rollback constraint. Alternatives: #9402 (GPT-6.1 Terra) is a model addition, #9404 (audit rollup) is Enterprise audit, #9436 (Files pagination) has no confirmed UI rollout, #9428 (Search/Assistant) has outstanding worker and feature-flag uncertainty. The security/action-required story beats all alternatives on necessity and breadth of self-hosted operator impact. Merged to staging with no release tag — availability is unverified and owner review is essential before publication.

## Proposed article

Sim self-hosted deployments encrypt connected-account OAuth tokens at rest when a valid 64-hex encryption key is set, with a migrate backfill for stored tokens and a rollback restriction below v0.9.33.

Sim seals connected-account OAuth tokens at rest using `ENCRYPTION_KEY`. When the key is exactly 64 hex characters, each token is encrypted on write and the `migrate` step backfills previously stored tokens in small batches. Without a usable key, tokens continue to be stored in plain text and the app keeps working.

Set `ENCRYPT_ACCOUNT_TOKENS=false` on the app, background workers, and migrations container to opt out. Already-sealed tokens remain readable when opted out. Once tokens are sealed, do not roll back to a release older than v0.9.33—those releases cannot read sealed tokens, and every connected account would need to be reconnected. See [Account token sealing](https://docs.sim.ai/platform/self-hosting/security) for the full setup, the [upgrade guide](https://docs.sim.ai/platform/self-hosting/upgrades) for rolling-deploy considerations, and the [environment variables reference](https://docs.sim.ai/platform/self-hosting/environment-variables) for key format requirements.

## Editorial review

- Removed all 'now' claims from headline, summary, body, social, and email per automatic-draft guidelines — human publication review establishes rollout.
- Removed startup log message detail from body; operators can find it in the linked security guide. Retained in claims for evidence.
- Added 'Already-sealed tokens remain readable when opted out' to body — supported by docs excerpt ('tokens that are already sealed stay readable') and useful for operators evaluating the opt-out.
- Added 'opting out does not unseal stored tokens' to claims — supported by docs callout: 'Opting out does not unseal stored tokens.'
- PR merged to staging with no release tag. Availability is unverified. Owner must confirm rollout status before publication.
- v0.9.33 version number in rollback restriction comes from docs excerpts (security.mdx callout and upgrades.mdx). Owner should confirm this is the correct version before publication.
- Removed three doc links with anchor fragments (#account-token-sealing) and used base verified URLs instead, since only base URLs are in verifiedLinks.

## Source evidence

- When ENCRYPTION_KEY is exactly 64 hex characters, Sim encrypts connected-account OAuth tokens on write. Each process logs 'Account token sealing: enabled' with a key id at startup. — simstudioai/sim#9425
- The migrate step backfills tokens stored before sealing was on in small batches. When upgrading from a release older than v0.9.33, the backfill waits one hour after the upgrade migration before sealing stored tokens, so old pods have time to roll out. — simstudioai/sim#9425
- Rolling back to a release older than v0.9.33 after tokens are sealed makes every connected account require reconnection, because those releases cannot read sealed tokens. — simstudioai/sim#9425
- Set ENCRYPT_ACCOUNT_TOKENS=false on the app, background workers, and migrations container to opt out. Already-sealed tokens remain readable when opted out; opting out does not unseal stored tokens. — simstudioai/sim#9425
- The Helm chart init container and Compose migrations services pass ENCRYPTION_KEY and ENCRYPT_ACCOUNT_TOKENS to the migrations container automatically. Chart bumped to 1.11.10. — simstudioai/sim#9425

- https://github.com/simstudioai/sim/pull/9425

## Availability and open questions

- [ ] Has this shipped to Sim Cloud or is it self-hosted only? The PR targets staging with no release tag — owner must confirm availability before publication.
- [ ] Is v0.9.33 the correct minimum version for the rollback restriction, or should the version be confirmed before publication?
- [ ] Should the announcement mention the one-hour grace period during rolling deploys from pre-v0.9.33, or is linking to the upgrade guide sufficient?
- [ ] Owner review needed: confirm rollout status and whether any Cloud-side action is required for users.

## Links checked during drafting

- [Account token sealing](https://docs.sim.ai/platform/self-hosting/security)
- [Upgrade guide](https://docs.sim.ai/platform/self-hosting/upgrades)
- [Environment variables](https://docs.sim.ai/platform/self-hosting/environment-variables)

## Media production

Format: illustration
Subject: Encrypted-at-rest OAuth token storage concept for self-hosted Sim
Starting state: Abstract token shapes in plain form approaching a server vault
Action: Tokens enter the vault and are sealed with a key
Visible result: Vault closed and locked, tokens stored securely inside
Poster: Vault locked with key visible, tokens sealed inside
Framing: Centered composition, monochrome gouache/graphite on fine paper texture, no text, no fabricated UI, no invented results
Demonstration limits: Illustration only — does not establish behavior or rollout. Feature verified via PR #9425 docs excerpts and security patch. Independent owner review required before publication.

An editorial illustration representing encrypted-at-rest token storage for a self-hosted deployment. Composition: a restrained monochrome gouache/graphite landscape showing an abstract server vault or strongbox on fine paper texture. Token-like shapes are sealed inside the vault, which is closed with a visible key. No text, no fabricated UI, no invented results. The illustration communicates the concept of encryption at rest without depicting any specific interface.

1. Illustration: a monochrome gouache/graphite composition on fine paper texture — a locked strongbox or vault with abstract token shapes sealed inside, a key resting nearby. No text, no fabricated UI.

Suggested alt text: Illustration of abstract token shapes sealed inside a locked vault, representing encrypted-at-rest OAuth token storage in a self-hosted deployment

- [ ] Independently verify the feature and rollout; record evidence and limitations.
- [ ] Review a product capture, verified diagram, or original editorial illustration; retain capture or generation provenance.
- [ ] Choose the final image or video poster; verify it reads clearly at 390px. Candidate assets are not approved media.
- [ ] Add optimized versioned media, captions if spoken, and index.mdx with draft: true.
- [ ] Verify the final media on desktop and mobile and run the content audit.
- [ ] Feature owner confirms availability; editor approves copy and links.
- [ ] After the approved site deployment, verify article, media, RSS and sitemap before marking published.

## Announcement drafts

**Social**

Sim self-hosted encrypts connected-account OAuth tokens at rest when ENCRYPTION_KEY is a valid 64-hex value. The migrate step backfills stored tokens automatically. Do not roll back below v0.9.33 once tokens are sealed. Details in the security guide.

**Email**

If you self-host Sim, connected-account OAuth tokens are encrypted at rest when your ENCRYPTION_KEY is a valid 64-hex value. The migrate step backfills tokens stored before sealing was on. Important: once tokens are sealed, rolling back to a release older than v0.9.33 requires reconnecting every account. See the security guide for opt-out instructions and rolling-deploy guidance.

Final canonical URL is assigned when the reviewed article slug is chosen. Do not distribute these drafts before publication.

Editorial contract: apps/sim/content/changelog/README.md and editorial-standard.md. This brief is public repository content; keep private operational evidence in Sim.
