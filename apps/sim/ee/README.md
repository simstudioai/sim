# Sim Enterprise Edition

This directory contains enterprise features that require a valid Sim Enterprise license for production use.

## Features

- **SSO**: SAML and OIDC single sign-on authentication
- **Access Control**: Permission groups and role-based access control

## Structure

```
ee/
├── LICENSE
├── README.md
├── index.ts                    # Main barrel export
├── sso/
│   ├── index.ts
│   ├── components/             # SSO settings UI
│   ├── hooks/                  # React Query hooks
│   └── lib/                    # Utilities and constants
└── access-control/
    ├── index.ts
    ├── components/             # Access control settings UI
    ├── hooks/                  # React Query hooks
    └── lib/                    # Types and utilities
```

**Note:** API routes remain in `app/api/` as required by Next.js routing conventions:
- SSO API: `app/api/auth/sso/`
- Permission Groups API: `app/api/permission-groups/`

## Licensing

Code in this directory is **NOT** covered by the Apache 2.0 license. See [LICENSE](./LICENSE) for the Sim Enterprise License terms.

The rest of the Sim codebase outside this directory is licensed under Apache 2.0.

## For Open Source Users

You may delete this directory to use Sim under the Apache 2.0 license only. The application will continue to function without enterprise features.

## Development & Testing

You may copy and modify this software for development and testing purposes without requiring an Enterprise subscription. Production use requires a valid license.

## Enabling Enterprise Features

Enterprise features are controlled by environment variables and subscription status:

- `NEXT_PUBLIC_SSO_ENABLED` - Enable SSO for self-hosted instances
- `NEXT_PUBLIC_ACCESS_CONTROL_ENABLED` - Enable access control for self-hosted instances

On the hosted platform (sim.ai), these features are automatically available with an Enterprise subscription.

## Usage

```typescript
// Import enterprise components
import { SSO, AccessControl } from '@/ee'

// Or import specific features
import { SSO, useSSOProviders } from '@/ee/sso'
import { AccessControl, usePermissionGroups } from '@/ee/access-control'
```

## Contact

For Enterprise licensing inquiries, contact [sales@sim.ai](mailto:sales@sim.ai).
