<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/hexagon/base64@main/base64.png" alt="@hexagon/base64" width="200" height="200"><br>
  <br>Probably the only JavaScript base64 library you'll ever need!<br>
</p>

# @hexagon/base64

Encode, decode and validate base64/base64url to string/arraybuffer and vice-versa. Works in Node, Deno and browser.

[![Node.js CI](https://github.com/Hexagon/base64/actions/workflows/node.js.yml/badge.svg)](https://github.com/Hexagon/base64/actions/workflows/node.js.yml) [![Deno CI](https://github.com/Hexagon/base64/actions/workflows/deno.yml/badge.svg)](https://github.com/Hexagon/base64/actions/workflows/deno.yml) 
[![npm version](https://badge.fury.io/js/@hexagon%2Fbase64.svg)](https://badge.fury.io/js/@hexagon%2Fbase64) [![NPM Downloads](https://img.shields.io/npm/dm/@hexagon/base64.svg)](https://www.npmjs.org/package/@hexagon/base64) [![jsdelivr](https://data.jsdelivr.com/v1/package/npm/@hexagon/base64/badge?style=rounded)](https://www.jsdelivr.com/package/npm/@hexagon/base64) [![Codacy Badge](https://app.codacy.com/project/badge/Grade/4978bdbf495941c087ecb32b120f28ff)](https://www.codacy.com/gh/Hexagon/base64/dashboard?utm_source=github.com&amp;utm_medium=referral&amp;utm_content=Hexagon/base64&amp;utm_campaign=Badge_Grade)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/Hexagon/base64/blob/master/LICENSE) 

*   Supports regular base64 and base64url
*   Convert to/from string or arraybuffer
*   Validate / identify base64 and base64url
*   Works in Node.js >=4.0 (both require and import).
*   Works in Deno >=1.16.
*   Works in browsers as standalone, UMD or ES-module.
*   Includes [TypeScript](https://www.typescriptlang.org/) typings.


```javascript
// Encode string as regular base64
const example1enc = base64.fromString("Hellö Wörld, how are you doing today?!");
console.log(example1enc);
// > SGVsbMO2IFfDtnJsZCwgaG93IGFyZSB5b3UgZG9pbmcgdG9kYXk/IQ==

// Decode string as regular base64
const example1dec = base64.toString("SGVsbMO2IFfDtnJsZCwgaG93IGFyZSB5b3UgZG9pbmcgdG9kYXk/IQ==");
console.log(example1dec);
// > Hellö Wörld, how are you doing today?!
```

Full documentation available at [base64.56k.guru](https://base64.56k.guru)

## Quick Installation

Node.js: `npm install @hexagon/base64 --save`

Deno: `import base64 from "https://deno.land/x/b64@1.1.28/src/base64.js";`

For browser/cdn usage, refer to the documentation.

### Quick API

 - __fromArrayBuffer(buffer, urlMode)__ - Encodes `ArrayBuffer` into base64 or base64url if urlMode(optional) is true
 - __toArrayBuffer(str, urlMode)__ - Decodes base64url string (or base64url string if urlMode is true) to `ArrayBuffer`

 - __fromString(str, urlMode)__ - Encodes `String` into base64 string(base64url string if urlMode is true)
 - __toString(str, urlMode)__ - Decodes base64 or base64url string to `String`

- __validate(str, urlMode)__ - Returns true if `String` str is valid base64/base64 dependending on urlMode

## Contributing

See [Contribution Guide](https://base64.56k.guru/contributing.html)

## Donations

If you found this library helpful and wish to support its development, consider making a donation through [Hexagon's GitHub Sponsors page](https://github.com/sponsors/hexagon). Your generosity ensures the library's continued development and maintenance.

### Contributors

The underlying code is loosely based on [github.com/niklasvh/base64-arraybuffer](https://github.com/niklasvh/base64-arraybuffer)

## License

MIT
