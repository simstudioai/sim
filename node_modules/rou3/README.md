# 🌳 rou3

<!-- automd:badges codecov bundlejs -->

[![npm version](https://img.shields.io/npm/v/rou3)](https://npmjs.com/package/rou3)
[![npm downloads](https://img.shields.io/npm/dm/rou3)](https://npmjs.com/package/rou3)
[![bundle size](https://img.shields.io/bundlejs/size/rou3)](https://bundlejs.com/?q=rou3)
[![codecov](https://img.shields.io/codecov/c/gh/unjs/rou3)](https://codecov.io/gh/unjs/rou3)

<!-- /automd -->

Lightweight and fast router for JavaScript.

> [!NOTE]
> Radix3 migrated to Rou3! See [#108](https://github.com/unjs/radix3/issues/108) for notes and [radix3 branch](https://github.com/unjs/rou3/tree/radix3) for legacy codebase.

## Usage

**Install:**

<!-- automd:pm-install -->

```sh
# ✨ Auto-detect
npx nypm install rou3

# npm
npm install rou3

# yarn
yarn add rou3

# pnpm
pnpm install rou3

# bun
bun install rou3
```

<!-- /automd -->

**Import:**

<!-- automd:jsimport cdn cjs src="./src/index.ts"-->

**ESM** (Node.js, Bun)

```js
import {
  createRouter,
  addRoute,
  findRoute,
  removeRoute,
  findAllRoutes,
} from "rou3";
```

**CommonJS** (Legacy Node.js)

```js
const {
  createRouter,
  addRoute,
  findRoute,
  removeRoute,
  findAllRoutes,
} = require("rou3");
```

**CDN** (Deno, Bun and Browsers)

```js
import {
  createRouter,
  addRoute,
  findRoute,
  removeRoute,
  findAllRoutes,
} from "https://esm.sh/rou3";
```

<!-- /automd -->

**Create a router instance and insert routes:**

```js
import { createRouter, addRoute } from "rou3";

const router = createRouter(/* options */);

addRoute(router, "GET", "/path", { payload: "this path" });
addRoute(router, "POST", "/path/:name", { payload: "named route" });
addRoute(router, "GET", "/path/foo/**", { payload: "wildcard route" });
addRoute(router, "GET", "/path/foo/**:name", {
  payload: "named wildcard route",
});
```

**Match route to access matched data:**

```js
// Returns { payload: 'this path' }
findRoute(router, "GET", "/path");

// Returns { payload: 'named route', params: { name: 'fooval' } }
findRoute(router, "POST", "/path/fooval");

// Returns { payload: 'wildcard route' }
findRoute(router, "GET", "/path/foo/bar/baz");

// Returns undefined (no route matched for/)
findRoute(router, "GET", "/");
```

## License

<!-- automd:contributors license=MIT author="pi0" -->

Published under the [MIT](https://github.com/unjs/rou3/blob/main/LICENSE) license.
Made by [@pi0](https://github.com/pi0) and [community](https://github.com/unjs/rou3/graphs/contributors) 💛
<br><br>
<a href="https://github.com/unjs/rou3/graphs/contributors">
<img src="https://contrib.rocks/image?repo=unjs/rou3" />
</a>

<!-- /automd -->

<!-- automd:with-automd -->

---

_🤖 auto updated with [automd](https://automd.unjs.io)_

<!-- /automd -->
