# @simplewebauthn/browser <!-- omit in toc -->

![WebAuthn](https://img.shields.io/badge/WebAuthn-Simplified-blueviolet?style=for-the-badge&logo=WebAuthn)
[![npm (scoped)](https://img.shields.io/npm/v/@simplewebauthn/browser?style=for-the-badge&logo=npm)](https://www.npmjs.com/package/@simplewebauthn/browser)
[![JSR](https://jsr.io/badges/@simplewebauthn/browser?style=for-the-badge)](https://jsr.io/@simplewebauthn/browser)
![Browser Support](https://img.shields.io/badge/Browser-ES2021+-brightgreen?style=for-the-badge&logo=Mozilla+Firefox)
![Browser Support](https://img.shields.io/badge/Browser-ES5-brightgreen?style=for-the-badge&logo=Mozilla+Firefox)

- [Installation](#installation)
  - [Node LTS 20.x and higher](#node-lts-20x-and-higher)
  - [Deno v1.43 and higher](#deno-v143-and-higher)
  - [UMD](#umd)
    - [ES2021](#es2021)
    - [ES5](#es5)
- [Documentation](#documentation)

## Installation

This package can be installed from **[NPM](https://www.npmjs.com/package/@simplewebauthn/browser)**
and **[JSR](https://jsr.io/@simplewebauthn/browser)**:

### Node LTS 20.x and higher

```sh
npm install @simplewebauthn/browser
```

### Deno v1.43 and higher

```sh
deno add jsr:@simplewebauthn/browser
```

### UMD

This package can also be installed via **unpkg** by including the following script in your page's
`<head>` element. The library's methods will be available on the global **`SimpleWebAuthnBrowser`**
object.

> NOTE: The only difference between the two packages below is that the ES5 bundle includes some
> polyfills for older browsers. This adds some bundle size overhead, but _does_ enable use of
> `browserSupportsWebAuthn()` in older browsers to show appropriate UI when WebAuthn is unavailable.

#### ES2021

If you only need to support modern browsers, include the `ES2021` version:

```html
<script src="https://unpkg.com/@simplewebauthn/browser/dist/bundle/index.umd.min.js"></script>
```

#### ES5

If you need to support WebAuthn feature detection in deprecated browsers like IE11 and Edge Legacy,
include the `ES5` version:

```html
<script src="https://unpkg.com/@simplewebauthn/browser/dist/bundle/index.es5.umd.min.js"></script>
```

## Documentation

You can find in-depth documentation on this package here:
https://simplewebauthn.dev/docs/packages/browser
