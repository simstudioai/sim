# Microsoft Intune inventory: production record

Status: prepared for publication in the changelog refresh PR.

## Evidence and availability

- [PR #8780](https://github.com/simstudioai/sim/pull/8780), commit `37f5cdf310`, included in [v0.9.15](https://github.com/simstudioai/sim/releases/tag/v0.9.15), published October 8, 2026.
- Checked `blocks/blocks/intune.ts` and the Intune integration guide. Inventory reads, detected applications, and policy status are supported. Restart, lock, and retirement require confirmation; platform support and administrator permissions still apply.
- A work or school account, active Intune tenant license, appropriate role, and administrator consent are required. The release is evidence of self-hosted availability, not proof of rollout to every Cloud organization.

## Media provenance

Captured October 9, 2026 (October 10 UTC), from the running local app at commit `36f91a76e2`. The disposable demo workspace contains a Start block connected to Microsoft Intune. Select List Devices, open additional fields, set the sample filter `complianceState eq 'noncompliant'`, and set Page Size to 100.

Asset: `/changelog/intune-device-filter-v1.jpg`, 1280 × 720 pixels. Direct browser screenshot with the product's light theme and collapsed sidebar. No Microsoft credential is connected, no device query or remote action was executed, and no results or controls were generated. These capture details stay in this production record; the article describes the supported feature. The same capture supplies the share image and opens in the shared image lightbox.

## Editorial review

The article links the canonical integration catalog and exact Intune setup guide, retaining the license, role, and consent requirements. It has its own canonical RSS identity because other stories share v0.9.15. Review its image, public layout, lightbox, links, and mobile view before merging; CI runs content and repository gates.

## Announcement draft

Bring Microsoft Intune device inventory into your agents in Sim. Read managed devices, detected applications, and compliance status to prepare IT reviews. See account requirements and setup: https://www.sim.ai/changelog/intune-device-inventory

Draft only; no announcement has been sent.
