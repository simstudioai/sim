# Sim Enterprise Edition

This directory contains enterprise features that require a Sim Enterprise subscription
for production use.

## Features

- **SSO (Single Sign-On)**: OIDC and SAML authentication integration
- **Access Control**: Permission groups for fine-grained user access management
- **Whitelabeling**: Custom branding and theming for enterprise deployments
- **Directory provisioning (SCIM)**: SCIM 2.0 user and group provisioning from Okta, Microsoft Entra, and other identity providers, with group-to-access mapping

## Licensing

See [LICENSE](./LICENSE) for terms. Development and testing use is permitted.
Production deployment requires an active Enterprise subscription.

## Architecture

Enterprise features are imported directly throughout the codebase. The `ee/` directory
is required at build time. Feature visibility is controlled at runtime via environment
variables (e.g., `NEXT_PUBLIC_ACCESS_CONTROL_ENABLED`, `NEXT_PUBLIC_SSO_ENABLED`, `NEXT_PUBLIC_SCIM_ENABLED`), or all at once with `ENTERPRISE_ENABLED`.
