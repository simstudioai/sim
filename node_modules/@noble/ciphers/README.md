# noble-ciphers

Auditable & minimal JS implementation of Salsa20, ChaCha and AES.

- 🔒 Auditable
- 🔻 Tree-shakeable: unused code is excluded from your builds
- 🏎 Fast: hand-optimized for caveats of JS engines
- 🔍 Reliable: property-based / cross-library / wycheproof tests ensure correctness
- 💼 AES: ECB, CBC, CTR, CFB, GCM, SIV (nonce misuse-resistant), AESKW, AESKWP
- 💃 Salsa20, ChaCha, XSalsa20, XChaCha, ChaCha8, ChaCha12, Poly1305
- 🥈 Two AES implementations: pure JS or friendly wrapper around webcrypto
- 🪶 45KB (8KB gzipped) for everything, 10KB (3KB gzipped) for ChaCha build

For discussions, questions and support, visit
[GitHub Discussions](https://github.com/paulmillr/noble-ciphers/discussions)
section of the repository.

### This library belongs to _noble_ cryptography

> **noble cryptography** — high-security, easily auditable set of contained cryptographic libraries and tools.

- Zero or minimal dependencies
- Highly readable TypeScript / JS code
- PGP-signed releases and transparent NPM builds
- All libraries:
  [ciphers](https://github.com/paulmillr/noble-ciphers),
  [curves](https://github.com/paulmillr/noble-curves),
  [hashes](https://github.com/paulmillr/noble-hashes),
  [post-quantum](https://github.com/paulmillr/noble-post-quantum),
  4kb [secp256k1](https://github.com/paulmillr/noble-secp256k1) /
  [ed25519](https://github.com/paulmillr/noble-ed25519)
- [Check out homepage](https://paulmillr.com/noble/)
  for reading resources, documentation and apps built with noble

## Usage

> npm install @noble/ciphers

We support all major platforms and runtimes.
For [Deno](https://deno.land), ensure to use
[npm specifier](https://deno.land/manual@v1.28.0/node/npm_specifiers).
For React Native, you may need a
[polyfill for getRandomValues](https://github.com/LinusU/react-native-get-random-values).
A standalone file
[noble-ciphers.js](https://github.com/paulmillr/noble-ciphers/releases) is also available.

```js
// import * from '@noble/ciphers'; // Error: use sub-imports, to ensure small app size
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
// import { xchacha20poly1305 } from 'npm:@noble/ciphers@0.5.0/chacha'; // Deno
```

- [Examples](#examples)
  - [Encrypt with XChaCha20-Poly1305](#encrypt-with-xchacha20-poly1305)
  - [Encrypt with AES-256-GCM](#encrypt-with-aes-256-gcm)
  - [Different AES block modes](#different-aes-block-modes)
  - [Friendly wrapper around AES WebCrypto](#friendly-wrapper-around-aes-webcrypto)
  - [Use existing key instead of a new one](#use-existing-key-instead-of-a-new-one)
  - [Encrypt without nonce](#encrypt-without-nonce)
  - [Re-use same array for input & output](#re-use-same-array-for-input-and-output)
  - [All imports](#all-imports)
- [Internals](#internals)
  - [Implemented primitives](#implemented-primitives)
  - [Which cipher should I pick?](#which-cipher-should-i-pick)
  - [How to encrypt properly](#how-to-encrypt-properly)
  - [Nonces](#nonces)
  - [Encryption limits](#encryption-limits)
  - [AES internals and block modes](#aes-internals-and-block-modes)
- [Security](#security)
- [Speed](#speed)
- [Upgrading](#upgrading)
- [Contributing & testing](#contributing--testing)
- [Resources](#resources)

## Examples

#### Encrypt with XChaCha20-Poly1305

```js
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { utf8ToBytes } from '@noble/ciphers/utils';
import { randomBytes } from '@noble/ciphers/webcrypto';
const key = randomBytes(32);
const nonce = randomBytes(24);
const chacha = xchacha20poly1305(key, nonce);
const data = utf8ToBytes('hello, noble');
const ciphertext = chacha.encrypt(data);
const data_ = chacha.decrypt(ciphertext); // utils.bytesToUtf8(data_) === data
```

#### Encrypt with AES-256-GCM

```js
import { gcm } from '@noble/ciphers/aes';
import { utf8ToBytes } from '@noble/ciphers/utils';
import { randomBytes } from '@noble/ciphers/webcrypto';
const key = randomBytes(32);
const nonce = randomBytes(24);
const aes = gcm(key, nonce);
const data = utf8ToBytes('hello, noble');
const ciphertext = aes.encrypt(data);
const data_ = aes.decrypt(ciphertext); // utils.bytesToUtf8(data_) === data
```

#### Use existing key instead of a new one

```js
const key = new Uint8Array([
  169, 88, 160, 139, 168, 29, 147, 196, 14, 88, 237, 76, 243, 177, 109, 140,
  195, 140, 80, 10, 216, 134, 215, 71, 191, 48, 20, 104, 189, 37, 38, 55,
]);
const nonce = new Uint8Array([
  180, 90, 27, 63, 160, 191, 150, 33, 67, 212, 86, 71, 144, 6, 200, 102, 218,
  32, 23, 147, 8, 41, 147, 11,
]);
// or, hex:
import { hexToBytes } from '@noble/ciphers/utils';
const key2 = hexToBytes('4b7f89bac90a1086fef73f5da2cbe93b2fae9dfbf7678ae1f3e75fd118ddf999');
const nonce2 = hexToBytes('9610467513de0bbd7c4cc2c3c64069f1802086fbd3232b13');
```

#### Different AES block modes

```js
import { gcm, siv, ctr, cfb, cbc, ecb } from '@noble/ciphers/aes';
import { randomBytes } from '@noble/ciphers/webcrypto';
const plaintext = new Uint8Array(32).fill(16);
const key = randomBytes(32); // 24 for AES-192, 16 for AES-128
for (let cipher of [gcm, siv]) {
  const stream = cipher(key, randomBytes(12));
  const ciphertext_ = stream.encrypt(plaintext);
  const plaintext_ = stream.decrypt(ciphertext_);
}
for (const cipher of [ctr, cbc, cbc]) {
  const stream = cipher(key, randomBytes(16));
  const ciphertext_ = stream.encrypt(plaintext);
  const plaintext_ = stream.decrypt(ciphertext_);
}
for (const cipher of [ecb]) {
  const stream = cipher(key);
  const ciphertext_ = stream.encrypt(plaintext);
  const plaintext_ = stream.decrypt(ciphertext_);
}
```

#### Friendly wrapper around AES WebCrypto

Noble implements AES. Sometimes people want to use built-in `crypto.subtle` instead. However, it has terrible API.

We simplify access to built-ins. Note: it's always async.

```js
import { gcm, ctr, cbc, randomBytes } from '@noble/ciphers/webcrypto';
const plaintext = new Uint8Array(32).fill(16);
const key = randomBytes(32);
for (const cipher of [gcm]) {
  const stream = cipher(key, randomBytes(12));
  const ciphertext_ = await stream.encrypt(plaintext);
  const plaintext_ = await stream.decrypt(ciphertext_);
}
for (const cipher of [ctr, cbc]) {
  const stream = cipher(key, randomBytes(16));
  const ciphertext_ = await stream.encrypt(plaintext);
  const plaintext_ = await stream.decrypt(ciphertext_);
}
```

#### AESKW and AESKWP

```ts
import { aeskw, aeskwp } from '@noble/ciphers/aes';
import { hexToBytes } from '@noble/ciphers/utils';

const kek = hexToBytes('000102030405060708090A0B0C0D0E0F');
const keyData = hexToBytes('00112233445566778899AABBCCDDEEFF');
const ciphertext =  aeskw(kek).encrypt(keyData);
```

#### Encrypt without nonce

We provide API that manages nonce internally instead of exposing them to library's user.

For `encrypt`, a `nonceBytes`-length buffer is fetched from CSPRNG and prenended to encrypted ciphertext.

For `decrypt`, first `nonceBytes` of ciphertext are treated as nonce.

```js
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { managedNonce } from '@noble/ciphers/webcrypto';
import { hexToBytes, utf8ToBytes } from '@noble/ciphers/utils';
const key = hexToBytes('fa686bfdffd3758f6377abbc23bf3d9bdc1a0dda4a6e7f8dbdd579fa1ff6d7e1');
const chacha = managedNonce(xchacha20poly1305)(key); // manages nonces for you
const data = utf8ToBytes('hello, noble');
const ciphertext = chacha.encrypt(data);
const data_ = chacha.decrypt(ciphertext);
```

#### Re-use same array for input & output

This allows re-use Uint8Array between encryption/decryption calls (works if all plaintext or ciphertext are same size).

**_NOTE_**: some ciphers don't support unaligned (`byteOffset % 4 !== 0`) Uint8Array as destination, since it will significantly
decrease performance and this optimization will become pointless.

```js
import { chacha20poly1305 } from '@noble/ciphers/chacha';
import { utf8ToBytes } from '@noble/ciphers/utils';
import { randomBytes } from '@noble/ciphers/webcrypto';

const key = randomBytes(32);
const nonce = randomBytes(12);
const buf = new Uint8Array(12 + 16);
const _data = utf8ToBytes('hello, noble');
buf.set(_data, 0); // first 12 bytes
const _12b = buf.subarray(0, 12);

const chacha = chacha20poly1305(key, nonce);
chacha.encrypt(_12b, buf);
chacha.decrypt(buf, _12b); // _12b now same as _data
```

#### All imports

```js
import { gcm, siv } from '@noble/ciphers/aes';
import { xsalsa20poly1305 } from '@noble/ciphers/salsa';
import { secretbox } from '@noble/ciphers/salsa'; // == xsalsa20poly1305
import { chacha20poly1305, xchacha20poly1305 } from '@noble/ciphers/chacha';

// Unauthenticated encryption: make sure to use HMAC or similar
import { ctr, cfb, cbc, ecb, aeskw, aeskwp } from '@noble/ciphers/aes';
import { salsa20, xsalsa20 } from '@noble/ciphers/salsa';
import { chacha20, xchacha20, chacha8, chacha12 } from '@noble/ciphers/chacha';

// Utilities
import { bytesToHex, hexToBytes, bytesToUtf8, utf8ToBytes } from '@noble/ciphers/utils';
import { managedNonce, randomBytes } from '@noble/ciphers/webcrypto';

import { poly1305 } from '@noble/ciphers/_poly1305';
import { ghash, polyval } from '@noble/ciphers/_polyval';
```

## Internals

### Implemented primitives

- [Salsa20](https://cr.yp.to/snuffle.html) stream cipher was released in 2005.
Salsa's goal was to implement AES replacement that does not rely on S-Boxes,
which are hard to implement in a constant-time manner.
Salsa20 is usually faster than AES, a big deal on slow, budget mobile phones.
    - [XSalsa20](https://cr.yp.to/snuffle/xsalsa-20110204.pdf), extended-nonce
variant was released in 2008. It switched nonces from 96-bit to 192-bit,
and became safe to be picked at random.
    - Nacl / Libsodium popularized term "secretbox", a simple black-box
authenticated encryption. Secretbox is just xsalsa20-poly1305. We provide the
alias and corresponding seal / open methods. We don't provide "box" or "sealedbox".
    - Check out [PDF](https://cr.yp.to/snuffle/salsafamily-20071225.pdf) and
[wiki](https://en.wikipedia.org/wiki/Salsa20).
- [ChaCha20](https://cr.yp.to/chacha.html) stream cipher was released
  in 2008. ChaCha aims to increase the diffusion per round, but had slightly less
  cryptanalysis. It was standardized in
  [RFC 8439](https://datatracker.ietf.org/doc/html/rfc8439) and is now used in TLS 1.3.
    - [XChaCha20](https://datatracker.ietf.org/doc/html/draft-irtf-cfrg-xchacha)
      extended-nonce variant is also provided. Similar to XSalsa, it's safe to use with
      randomly-generated nonces.
    - Check out [PDF](http://cr.yp.to/chacha/chacha-20080128.pdf) and [wiki](https://en.wikipedia.org/wiki/Salsa20).
- [AES](https://en.wikipedia.org/wiki/Advanced_Encryption_Standard)
is a variant of Rijndael block cipher, standardized by NIST in 2001.
We provide the fastest available pure JS implementation.
    - We support AES-128, AES-192 and AES-256: the mode is selected dynamically,
      based on key length (16, 24, 32).
    - [AES-GCM-SIV](https://en.wikipedia.org/wiki/AES-GCM-SIV)
    nonce-misuse-resistant mode is also provided. It's recommended to use it,
    to prevent catastrophic consequences of nonce reuse. Our implementation of SIV
    has the same speed as GCM: there is no performance hit.
    - We also have AESKW and AESKWP from
      [RFC 3394](https://datatracker.ietf.org/doc/html/rfc3394) / [RFC 5649](https://datatracker.ietf.org/doc/html/rfc5649)
    - Check out [AES internals and block modes](#aes-internals-and-block-modes).
- We expose polynomial-evaluation MACs: [Poly1305](https://cr.yp.to/mac.html), AES-GCM's [GHash](https://en.wikipedia.org/wiki/Galois/Counter_Mode) and
AES-SIV's [Polyval](https://en.wikipedia.org/wiki/AES-GCM-SIV).
    - Poly1305 ([PDF](https://cr.yp.to/mac/poly1305-20050329.pdf),
    [wiki](https://en.wikipedia.org/wiki/Poly1305))
    is a fast and parallel secret-key message-authentication code suitable for
    a wide variety of applications. It was standardized in
    [RFC 8439](https://datatracker.ietf.org/doc/html/rfc8439) and is now used in TLS 1.3.
    - Polynomial MACs are not perfect for every situation:
    they lack Random Key Robustness: the MAC can be forged, and can't
    be used in PAKE schemes. See
    [invisible salamanders attack](https://keymaterial.net/2020/09/07/invisible-salamanders-in-aes-gcm-siv/).
    To combat invisible salamanders, `hash(key)` can be included in ciphertext,
    however, this would violate ciphertext indistinguishability:
    an attacker would know which key was used - so `HKDF(key, i)`
    could be used instead.
- Format-preserving encryption algorithm (FPE-FF1) specified in NIST Special Publication 800-38G.
[See more info](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-38G.pdf).

### Which cipher should I pick?

To simplify, XChaCha20-Poly1305 is the safest bet these days.
AES-GCM-SIV is the second safest.
AES-GCM is the third.

### How to encrypt properly

- Use unpredictable key with enough entropy
  - Random key must be using cryptographically secure random number generator (CSPRNG), not `Math.random` etc.
  - Non-random key generated from KDF is fine
  - Re-using key is fine, but be aware of rules for cryptographic key wear-out and [encryption limits](#encryption-limits)
- Use new nonce every time and [don't repeat it](#nonces)
  - chacha and salsa20 are fine for sequential counters that _never_ repeat: `01, 02...`
  - xchacha and xsalsa20 should be used for random nonces instead
- Prefer authenticated encryption (AEAD)
  - HMAC+ChaCha / HMAC+AES / chacha20poly1305 / aes-gcm is good
  - chacha20 without poly1305 or hmac / aes-ctr / aes-cbc is bad
  - Flipping bits or ciphertext substitution won't be detected in unauthenticated ciphers
- Don't re-use keys between different protocols
  - For example, using secp256k1 key in AES is bad
  - Use hkdf or, at least, a hash function to create sub-key instead

### Nonces

Most ciphers need a key and a nonce (aka initialization vector / IV) to encrypt a data:

    ciphertext = encrypt(plaintext, key, nonce)

Repeating (key, nonce) pair with different plaintexts would allow an attacker to decrypt it:

    ciphertext_a = encrypt(plaintext_a, key, nonce)
    ciphertext_b = encrypt(plaintext_b, key, nonce)
    stream_diff = xor(ciphertext_a, ciphertext_b)   # Break encryption

So, you can't repeat nonces. One way of doing so is using counters:

    for i in 0..:
        ciphertext[i] = encrypt(plaintexts[i], key, i)

Another is generating random nonce every time:

    for i in 0..:
        rand_nonces[i] = random()
        ciphertext[i] = encrypt(plaintexts[i], key, rand_nonces[i])

Counters are OK, but it's not always possible to store current counter value:
e.g. in decentralized, unsyncable systems.

Randomness is OK, but there's a catch:
ChaCha20 and AES-GCM use 96-bit / 12-byte nonces, which implies
higher chance of collision. In the example above,
`random()` can collide and produce repeating nonce.

To safely use random nonces, utilize XSalsa20 or XChaCha:
they increased nonce length to 192-bit, minimizing a chance of collision.
AES-SIV is also fine. In situations where you can't use eXtended-nonce
algorithms, key rotation is advised. hkdf would work great for this case.

### Encryption limits

A "protected message" would mean a probability of `2**-50` that a passive attacker
successfully distinguishes the ciphertext outputs of the AEAD scheme from the outputs
of a random function. See [draft-irtf-cfrg-aead-limits](https://datatracker.ietf.org/doc/draft-irtf-cfrg-aead-limits/) for details.

- Max message size:
  - AES-GCM: ~68GB, `2**36-256`
  - Salsa, ChaCha, XSalsa, XChaCha: ~256GB, `2**38-64`
- Max amount of protected messages, under same key:
  - AES-GCM: `2**32.5`
  - Salsa, ChaCha: `2**46`, but only integrity is affected, not confidentiality
  - XSalsa, XChaCha: `2**72`
- Max amount of protected messages, across all keys:
  - AES-GCM: `2**69/B` where B is max blocks encrypted by a key. Meaning
    `2**59` for 1KB, `2**49` for 1MB, `2**39` for 1GB
  - Salsa, ChaCha, XSalsa, XChaCha: `2**100`

##### AES internals and block modes

`cipher = encrypt(block, key)`. Data is split into 128-bit blocks. Encrypted in 10/12/14 rounds (128/192/256bit). Every round does:

1. **S-box**, table substitution
2. **Shift rows**, cyclic shift left of all rows of data array
3. **Mix columns**, multiplying every column by fixed polynomial
4. **Add round key**, round_key xor i-th column of array

For non-deterministic (not ECB) schemes, initialization vector (IV) is mixed to block/key;
and each new round either depends on previous block's key, or on some counter.

- ECB — simple deterministic replacement. Dangerous: always map x to y. See [AES Penguin](https://words.filippo.io/the-ecb-penguin/)
- CBC — key is previous round’s block. Hard to use: need proper padding, also needs MAC
- CTR — counter, allows to create streaming cipher. Requires good IV. Parallelizable. OK, but no MAC
- GCM — modern CTR, parallel, with MAC
- SIV — synthetic initialization vector, nonce-misuse-resistant. Guarantees that, when a nonce is repeated,
  the only security loss is that identical plaintexts will produce identical ciphertexts.
- XTS — used in hard drives. Similar to ECB (deterministic), but has `[i][j]`
  tweak arguments corresponding to sector i and 16-byte block (part of sector) j. Not authenticated!

GCM / SIV are not ideal:

- Conservative key wear-out is `2**32` (4B) msgs
- MAC can be forged: see Poly1305 section above. Same for SIV

## Security

The library has not been independently audited yet.

It is tested against property-based, cross-library and Wycheproof vectors,
and has fuzzing by [Guido Vranken's cryptofuzz](https://github.com/guidovranken/cryptofuzz).

If you see anything unusual: investigate and report.

### Constant-timeness

_JIT-compiler_ and _Garbage Collector_ make "constant time" extremely hard to
achieve [timing attack](https://en.wikipedia.org/wiki/Timing_attack) resistance
in a scripting language. Which means _any other JS library can't have
constant-timeness_. Even statically typed Rust, a language without GC,
[makes it harder to achieve constant-time](https://www.chosenplaintext.ca/open-source/rust-timing-shield/security)
for some cases. If your goal is absolute security, don't use any JS lib — including bindings to native ones.
Use low-level libraries & languages. Nonetheless we're targetting algorithmic constant time.

AES uses T-tables, which means it can't be done in constant-time in JS.

### Supply chain security

- **Commits** are signed with PGP keys, to prevent forgery. Make sure to verify commit signatures.
- **Releases** are transparent and built on GitHub CI. Make sure to verify [provenance](https://docs.npmjs.com/generating-provenance-statements) logs
- **Rare releasing** is followed to ensure less re-audit need for end-users
- **Dependencies** are minimized and locked-down:
  - If your app has 500 dependencies, any dep could get hacked and you'll be downloading
    malware with every install. We make sure to use as few dependencies as possible
  - We prevent automatic dependency updates by locking-down version ranges. Every update is checked with `npm-diff`
- **Dev Dependencies** are only used if you want to contribute to the repo. They are disabled for end-users:
  - scure-base, micro-bmark and micro-should are developed by the same author and follow identical security practices
  - prettier (linter), fast-check (property-based testing) and typescript are used for code quality, vector generation and ts compilation. The packages are big, which makes it hard to audit their source code thoroughly and fully

### Randomness

We're deferring to built-in
[crypto.getRandomValues](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues)
which is considered cryptographically secure (CSPRNG).

In the past, browsers had bugs that made it weak: it may happen again.
Implementing a userspace CSPRNG to get resilient to the weakness
is even worse: there is no reliable userspace source of quality entropy.

## Speed

To summarize, noble is the fastest JS implementation of Salsa, ChaCha and AES.

You can gain additional speed-up and
avoid memory allocations by passing `output`
uint8array into encrypt / decrypt methods.

Benchmark results on Apple M2 with node v20:

```
encrypt (64B)
├─xsalsa20poly1305 x 485,908 ops/sec @ 2μs/op
├─chacha20poly1305 x 419,639 ops/sec @ 2μs/op
├─xchacha20poly1305 x 335,232 ops/sec @ 2μs/op
├─aes-256-gcm x 143,595 ops/sec @ 6μs/op
└─aes-256-gcm-siv x 120,743 ops/sec @ 8μs/op
encrypt (1KB)
├─xsalsa20poly1305 x 135,924 ops/sec @ 7μs/op
├─chacha20poly1305 x 134,843 ops/sec @ 7μs/op
├─xchacha20poly1305 x 124,626 ops/sec @ 8μs/op
├─aes-256-gcm x 39,588 ops/sec @ 25μs/op
└─aes-256-gcm-siv x 36,989 ops/sec @ 27μs/op
encrypt (8KB)
├─xsalsa20poly1305 x 22,178 ops/sec @ 45μs/op
├─chacha20poly1305 x 22,691 ops/sec @ 44μs/op
├─xchacha20poly1305 x 22,463 ops/sec @ 44μs/op
├─aes-256-gcm x 8,082 ops/sec @ 123μs/op
└─aes-256-gcm-siv x 7,907 ops/sec @ 126μs/op
encrypt (1MB)
├─xsalsa20poly1305 x 171 ops/sec @ 5ms/op
├─chacha20poly1305 x 186 ops/sec @ 5ms/op
├─xchacha20poly1305 x 189 ops/sec @ 5ms/op
├─aes-256-gcm x 73 ops/sec @ 13ms/op
└─aes-256-gcm-siv x 77 ops/sec @ 12ms/op
```

Unauthenticated encryption:

```
encrypt (64B)
├─salsa x 1,245,330 ops/sec @ 803ns/op
├─chacha x 1,468,428 ops/sec @ 681ns/op
├─xsalsa x 995,024 ops/sec @ 1μs/op
└─xchacha x 1,026,694 ops/sec @ 974ns/op
encrypt (1KB)
├─salsa x 349,283 ops/sec @ 2μs/op
├─chacha x 369,822 ops/sec @ 2μs/op
├─xsalsa x 326,370 ops/sec @ 3μs/op
└─xchacha x 334,001 ops/sec @ 2μs/op
encrypt (8KB)
├─salsa x 55,050 ops/sec @ 18μs/op
├─chacha x 56,474 ops/sec @ 17μs/op
├─xsalsa x 54,068 ops/sec @ 18μs/op
└─xchacha x 55,469 ops/sec @ 18μs/op
encrypt (1MB)
├─salsa x 449 ops/sec @ 2ms/op
├─chacha x 459 ops/sec @ 2ms/op
├─xsalsa x 448 ops/sec @ 2ms/op
└─xchacha x 459 ops/sec @ 2ms/op

AES
encrypt (64B)
├─ctr-256 x 689,179 ops/sec @ 1μs/op
├─cbc-256 x 639,795 ops/sec @ 1μs/op
└─ecb-256 x 668,449 ops/sec @ 1μs/op
encrypt (1KB)
├─ctr-256 x 93,668 ops/sec @ 10μs/op
├─cbc-256 x 94,428 ops/sec @ 10μs/op
└─ecb-256 x 151,699 ops/sec @ 6μs/op
encrypt (8KB)
├─ctr-256 x 13,342 ops/sec @ 74μs/op
├─cbc-256 x 13,664 ops/sec @ 73μs/op
└─ecb-256 x 22,426 ops/sec @ 44μs/op
encrypt (1MB)
├─ctr-256 x 106 ops/sec @ 9ms/op
├─cbc-256 x 109 ops/sec @ 9ms/op
└─ecb-256 x 179 ops/sec @ 5ms/op
```

Compare to other implementations:

```
xsalsa20poly1305 (encrypt, 1MB)
├─tweetnacl x 108 ops/sec @ 9ms/op
└─noble x 190 ops/sec @ 5ms/op

chacha20poly1305 (encrypt, 1MB)
├─node x 1,360 ops/sec @ 735μs/op
├─stablelib x 117 ops/sec @ 8ms/op
└─noble x 193 ops/sec @ 5ms/op

chacha (encrypt, 1MB)
├─node x 2,035 ops/sec @ 491μs/op
├─stablelib x 206 ops/sec @ 4ms/op
└─noble x 474 ops/sec @ 2ms/op

ctr-256 (encrypt, 1MB)
├─node x 3,530 ops/sec @ 283μs/op
├─stablelib x 70 ops/sec @ 14ms/op
├─aesjs x 31 ops/sec @ 32ms/op
├─noble-webcrypto x 4,589 ops/sec @ 217μs/op
└─noble x 107 ops/sec @ 9ms/op

cbc-256 (encrypt, 1MB)
├─node x 993 ops/sec @ 1ms/op
├─stablelib x 63 ops/sec @ 15ms/op
├─aesjs x 29 ops/sec @ 34ms/op
├─noble-webcrypto x 1,087 ops/sec @ 919μs/op
└─noble x 110 ops/sec @ 9ms/op

gcm-256 (encrypt, 1MB)
├─node x 3,196 ops/sec @ 312μs/op
├─stablelib x 27 ops/sec @ 36ms/op
├─noble-webcrypto x 4,059 ops/sec @ 246μs/op
└─noble x 74 ops/sec @ 13ms/op
```

## Upgrading

Upgrade from `micro-aes-gcm` package is simple:

```js
// prepare
const key = Uint8Array.from([
  64, 196, 127, 247, 172, 2, 34, 159, 6, 241, 30, 174, 183, 229, 41, 114, 253, 122, 119, 168, 177,
  243, 155, 236, 164, 159, 98, 72, 162, 243, 224, 195,
]);
const message = 'Hello world';

// previous
import * as aes from 'micro-aes-gcm';
const ciphertext = await aes.encrypt(key, aes.utils.utf8ToBytes(message));
const plaintext = await aes.decrypt(key, ciphertext);
console.log(aes.utils.bytesToUtf8(plaintext) === message);

// became =>

import { gcm } from '@noble/ciphers/aes';
import { bytesToUtf8, utf8ToBytes } from '@noble/ciphers/utils';
import { managedNonce } from '@noble/ciphers/webcrypto';
const aes = managedNonce(gcm)(key);
const ciphertext = aes.encrypt(utf8ToBytes(message));
const plaintext = aes.decrypt(key, ciphertext);
console.log(bytesToUtf8(plaintext) === message);
```

## Contributing & testing

1. Clone the repository
2. `npm install` to install build dependencies like TypeScript
3. `npm run build` to compile TypeScript code
4. `npm run test` will execute all main tests

## Resources

Check out [paulmillr.com/noble](https://paulmillr.com/noble/)
for useful resources, articles, documentation and demos
related to the library.

## License

The MIT License (MIT)

Copyright (c) 2023 Paul Miller [(https://paulmillr.com)](https://paulmillr.com)
Copyright (c) 2016 Thomas Pornin <pornin@bolet.org>

See LICENSE file.
