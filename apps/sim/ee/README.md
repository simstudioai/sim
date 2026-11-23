# Sim Enterprise Edition

This directory contains enterprise features that require a Sim Enterprise subscription
for production use.

## Features

- **SSO (Single Sign-On)**: OIDC and SAML authentication integration
- **Access Control**: Permission groups for fine-grained user access management
- **Access Requests**: Members request restricted features or a higher credit cap; organization admins review and apply them. On for every entitled organization unless it opts out
- **Directory provisioning (SCIM)**: SCIM 2.0 user and group provisioning from Okta, Microsoft Entra, and other identity providers, with group-to-access mapping

## Licensing

See [LICENSE](./LICENSE) for terms. Development and testing use is permitted.
Production deployment requires an active Enterprise subscription.

## Architecture

Enterprise features are imported directly throughout the codebase. The `ee/` directory
is required at build time. Feature visibility is controlled at runtime via environment
variables, one server variable per feature (e.g., `ACCESS_CONTROL_ENABLED`, `SSO_ENABLED`, `SCIM_ENABLED`), or all at once with `ENTERPRISE_ENABLED`.
The registry in `packages/deployment-config/src/enterprise-features.ts` declares every feature and its default; the browser
receives the server-resolved state, so there are no `NEXT_PUBLIC_*` twins to set.
