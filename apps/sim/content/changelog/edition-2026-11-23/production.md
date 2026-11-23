# Try Sim Pro free for 14 days

Status: editorial draft. Availability and media require review before an article is added.

## Editorial selection

Story type: feature

PR #10330 introduces a 14-day free trial for individual Pro subscribers—a substantial new user-facing billing capability with clear eligibility rules, credit cap, and cancellation path, all documented in the costs docs. It is the only source in the batch. However, it merged to staging with no release tag and unverified availability, so the draft cannot claim current rollout. All other PRs mentioned in the original draft reason are absent from the evidence packet. Questions flag availability for owner review before publication.

## Proposed article

Sim introduces a 14-day free trial for new individual Pro subscribers. A card is required at checkout and is charged for Pro when the trial ends unless you cancel first.

New individual Pro subscribers can start a 14-day free trial at checkout. During the trial you get Pro features and Sim-hosted models and tools, with a fixed allowance of 2,000 credits. There is no weekly credit refresh, the usage limit cannot be raised, and nothing is billed past the allowance. When the trial converts, the full Pro allowance applies.

To start, go to **Settings → Subscription** and select the Pro plan. Cancel there before the trial ends to avoid being charged. Each account and each card can start one trial; a checkout whose card already started a trial is charged immediately instead. Team plans and Max do not include a trial. See [current pricing and credit details](https://docs.sim.ai/platform/costs).

## Editorial review

- Removed 'now' from summary, social, and email per editorial rule against rollout claims in automatic drafts.
- PR #10330 merged to staging with no release tag and unverified availability. Owner must confirm shipment and release version before publication.
- All four claims verified against the docs excerpt in costs.mdx and the PR description. No unsupported claims remain.
- Only one source exists in the evidence packet; no supporting notes are possible without additional tagged PRs.

## Source evidence

- New individual Pro subscribers get a 14-day free trial; checkout requires a card, which is charged for Pro when the trial ends unless cancelled first under Settings → Subscription. — simstudioai/sim#10330
- During the trial, subscribers receive Pro features and Sim-hosted models and tools, with a fixed allowance of 2,000 credits; there is no weekly refresh and the usage limit cannot be raised. — simstudioai/sim#10330
- Each account and each card can start one trial; a checkout whose card already started a trial is charged immediately. — simstudioai/sim#10330
- Team plans and Max do not include a trial. — simstudioai/sim#10330

- https://github.com/simstudioai/sim/pull/10330

## Availability and open questions

- [ ] This PR merged to staging with no release tag and unverified availability. Has it shipped to Sim Cloud, and what release version includes it?
- [ ] Are there regional or account-type restrictions on trial eligibility beyond what the costs docs describe?
- [ ] Is Settings → Subscription the correct path in the current UI, and is there a direct upgrade URL that should be linked?

## Links checked during drafting

- [Pricing and credit details](https://docs.sim.ai/platform/costs)

## Media production

Format: screenshot
Subject: Sim Settings → Subscription panel showing the Pro free trial offer
Starting state: Eligible free-plan account with Settings → Subscription open, showing plan options
Action: Scroll to the Pro plan card displaying the 14-day free trial offer and 2,000-credit allowance
Visible result: Pro plan card fully visible with trial period, credit allowance, and card-required note readable
Poster: Pro plan card showing 14-day free trial and 2,000-credit allowance clearly legible
Framing: 390px wide, light mode, subscription settings panel centered, no personal account data visible
Demonstration limits: Screenshot must be taken on a real eligible account in the live Sim settings flow with actual trial offer UI visible. Feature availability is unverified: PR merged to staging with no release tag. Confirm the trial UI is live before capture.

Capture a screenshot of the Sim billing settings showing the Pro free trial offer. The image should display the Pro plan card with the 14-day trial period, 2,000-credit allowance, and card-required checkout note clearly legible. Use a real eligible free-plan account in the live Sim settings flow. No personal account data, payment details, or placeholder text should be visible.

1. Open Settings → Subscription on an eligible free-plan Sim account in light mode at 390px width.
2. Scroll to the Pro plan card so the 14-day free trial offer and 2,000-credit allowance are fully visible.
3. Capture the final frame with the trial terms clearly legible and no personal data shown.

Suggested alt text: Sim Settings showing the Subscription panel with a Pro plan card offering a 14-day free trial and a 2,000-credit allowance.

- [ ] Independently verify the feature and rollout; record evidence and limitations.
- [ ] Review a product capture, verified diagram, or original editorial illustration; retain capture or generation provenance.
- [ ] Choose the final image or video poster; verify it reads clearly at 390px. Candidate assets are not approved media.
- [ ] Add optimized versioned media, captions if spoken, and index.mdx with draft: true.
- [ ] Verify the final media on desktop and mobile and run the content audit.
- [ ] Feature owner confirms availability; editor approves copy and links.
- [ ] After the approved site deployment, verify article, media, RSS and sitemap before marking published.

## Announcement drafts

**Social**

Sim Pro offers a 14-day free trial for new individual subscribers. You get Pro features, Sim-hosted models and tools, and a 2,000-credit allowance—no charge until the trial ends. Cancel anytime in Settings → Subscription. Details: https://docs.sim.ai/platform/costs

**Email**

Subject: Try Sim Pro free for 14 days

New individual Pro subscribers can start a 14-day free trial at checkout. During the trial you get Pro features and Sim-hosted models and tools, with a fixed allowance of 2,000 credits—no weekly refresh, no overage, and no charge until the trial ends.

To start, go to Settings → Subscription and select Pro. Cancel before the trial ends to avoid being charged. Each account and card can start one trial. Team plans and Max are not included.

See pricing and credit details: https://docs.sim.ai/platform/costs

Final canonical URL is assigned when the reviewed article slug is chosen. Do not distribute these drafts before publication.

Editorial contract: apps/sim/content/changelog/README.md and editorial-standard.md. This brief is public repository content; keep private operational evidence in Sim.
