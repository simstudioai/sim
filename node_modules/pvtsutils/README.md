[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Coverage Status](https://coveralls.io/repos/github/PeculiarVentures/pvtsutils/badge.svg?branch=master)](https://coveralls.io/github/PeculiarVentures/pvtsutils?branch=master)
[![Test](https://github.com/PeculiarVentures/pvtsutils/actions/workflows/test.yml/badge.svg)](https://github.com/PeculiarVentures/pvtsutils/actions/workflows/test.yml)

# pvtsutils
pvtsutils is a set of common utility functions used in various Peculiar Ventures TypeScript based projects.

## Install

```
npm install pvtsutils
```

## Using

```javascript
const utils = require("pvtsutils");
```

The `pvtsutils` namespace will always be available globally and also supports AMD loaders.

## Types

There is an [index.d.ts](./index.d.ts) file which makes easy to use current module as external

## Helpers

### Convert

Helps to convert `string` to `ArrayBuffer` and back

Convert support next encoding types `hex`, `utf8`, `binary`, `base64`, `base64url`. `utf8` is default.

#### Examples

Converts string to buffer

```javascript
const buf = Convert.FromString("some string", "hex");
```

Converts buffer to string

```javascript
const str = Convert.ToString(buf, "utf8");
```

### assign

Copies properties from objects to a target object. [More info](https://developer.mozilla.org/en/docs/Web/JavaScript/Reference/Global_Objects/Object/assign)

#### Example

```javascript
const obj = assign({}, {name: "Bob"}, {age: 12}); // {name: "Bob", age: 12}
```

### isEqual

Returns `true` if 2 ArrayBuffers are equal

### combine

Combines some `ArrayBuffer` values

#### Example

```javascript
const buf1 = new Uint8Array([1, 2, 3]);
const buf2 = new Uint8Array([4, 5, 6]);
const buf = combine(buf1, buf2); // [1, 2, 3, 4, 5, 6]
```

Some example capabilities included in pvtsutils include:

- Converting values to adn from hex,
- Converting values to and from base64,
- Working with base64 url,
- Working with binary data.
- And more...
