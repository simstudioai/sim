# @simplewebauthn/server <!-- omit in toc -->

![WebAuthn](https://img.shields.io/badge/WebAuthn-Simplified-blueviolet?style=for-the-badge&logo=WebAuthn)
[![npm (scoped)](https://img.shields.io/npm/v/@simplewebauthn/server?style=for-the-badge&logo=npm)](https://www.npmjs.com/package/@simplewebauthn/server)
[![JSR](https://jsr.io/badges/@simplewebauthn/server?style=for-the-badge)](https://jsr.io/@simplewebauthn/server)

- [Installation](#installation)
  - [Node LTS 20.x and higher](#node-lts-20x-and-higher)
  - [Deno v1.43 and higher](#deno-v143-and-higher)
- [Documentation](#documentation)
- [Supported Attestation Formats](#supported-attestation-formats)

## Installation

This package can be installed from **[NPM](https://www.npmjs.com/package/@simplewebauthn/server)**
and **[JSR](https://jsr.io/@simplewebauthn/server)**:

### Node LTS 20.x and higher

```sh
npm install @simplewebauthn/server
```

### Deno v1.43 and higher

```sh
deno add jsr:@simplewebauthn/server
```

## Documentation

You can find in-depth documentation on this package here:
https://simplewebauthn.dev/docs/packages/server

## Supported Attestation Formats

SimpleWebAuthn supports
[all current WebAuthn attestation formats](https://w3c.github.io/webauthn/#sctn-defined-attestation-formats),
including:

- **Android Key**
- **Android SafetyNet**
- **Apple**
- **FIDO U2F**
- **Packed**
- **TPM**
- **None**
