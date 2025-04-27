# `@peculiar/asn1-android`

[![License](https://img.shields.io/badge/license-MIT-green.svg?style=flat)](https://raw.githubusercontent.com/PeculiarVentures/asn1-schema/master/packages/android/LICENSE.md)
[![npm version](https://badge.fury.io/js/%40peculiar%2Fasn1-android.svg)](https://badge.fury.io/js/%40peculiar%2Fasn1-android)

[![NPM](https://nodei.co/npm/@peculiar/asn1-android.png)](https://nodei.co/npm/@peculiar/asn1-android/)

- [Android key attestation schema](https://source.android.com/security/keystore/attestation#schema)
- [Key attestation extension data schema](https://developer.android.com/privacy-and-security/security-key-attestation#key_attestation_ext_schema)
- [AttestationApplicationId](https://developer.android.com/privacy-and-security/security-key-attestation#key_attestation_ext_schema_attestationid)

## KeyDescription and NonStandardKeyDescription

The `KeyDescription` class in this library represents the ASN.1 schema for the Android Keystore Key Description structure. However, in practice, there are cases where the `AuthorizationList` fields in the `softwareEnforced` and `teeEnforced` fields are not strictly ordered, which can lead to ASN.1 structure reading errors.

Starting with version 300, the schema has been updated to use `keyMintVersion` instead of `keymasterVersion`, `keyMintSecurityLevel` instead of `keymasterSecurityLevel`, and `hardwareEnforced` instead of `teeEnforced`. To support this, we've added the `KeyMintKeyDescription` class which works for both v300 and v400.

To address the non-strict ordering issue, this library provides `NonStandardKeyDescription` and `NonStandardKeyMintKeyDescription` classes that can read such structures. However, when creating extensions, it is recommended to use `KeyDescription` or `KeyMintKeyDescription`, as they guarantee the order of object fields according to the specification.

Here are simplified TypeScript examples:

Example of creating a `KeyDescription` object in TypeScript for the Android Keystore system

```typescript
const attestation = new android.AttestationApplicationId({
  packageInfos: [
    new android.AttestationPackageInfo({
      packageName: new OctetString(Buffer.from("123", "utf8")),
      version: 1,
    }),
  ],
  signatureDigests: [new OctetString(Buffer.from("123", "utf8"))],
});

// Legacy KeyDescription
const keyDescription = new KeyDescription({
  attestationVersion: android.Version.keyMint2,
  attestationSecurityLevel: android.SecurityLevel.software,
  keymasterVersion: 1,
  keymasterSecurityLevel: android.SecurityLevel.software,
  attestationChallenge: new OctetString(Buffer.from("123", "utf8")),
  uniqueId: new OctetString(Buffer.from("123", "utf8")),
  softwareEnforced: new android.AuthorizationList({
    creationDateTime: 1506793476000,
    attestationApplicationId: new OctetString(AsnConvert.serialize(attestation)),
  }),
  teeEnforced: new android.AuthorizationList({
    purpose: new android.IntegerSet([1]),
    algorithm: 1,
    keySize: 1,
    digest: new android.IntegerSet([1]),
    ecCurve: 1,
    userAuthType: 1,
    origin: 1,
    rollbackResistant: null,
  }),
});

// KeyMint KeyDescription (works for both v300 and v400)
const keyMintDescription = new KeyMintKeyDescription({
  attestationVersion: android.Version.keyMint4, // Use Version.keyMint3 for v300
  attestationSecurityLevel: android.SecurityLevel.software,
  keyMintVersion: 1,
  keyMintSecurityLevel: android.SecurityLevel.trustedEnvironment,
  attestationChallenge: new OctetString(Buffer.from("challenge-data", "utf8")),
  uniqueId: new OctetString(Buffer.from("unique-id-data", "utf8")),
  softwareEnforced: new android.AuthorizationList({
    creationDateTime: 1684321765000,
  }),
  hardwareEnforced: new android.AuthorizationList({
    purpose: new android.IntegerSet([1, 2]),
    algorithm: 3, // EC
    keySize: 256,
    attestationIdSecondImei: new OctetString(Buffer.from("second-imei", "utf8")),
    moduleHash: new OctetString(Buffer.from("module-hash-value", "utf8")), // Available in v400
    rootOfTrust: new android.RootOfTrust({
      verifiedBootKey: new OctetString(Buffer.from("boot-key-data", "utf8")),
      deviceLocked: true,
      verifiedBootState: android.VerifiedBootState.verified,
      verifiedBootHash: new OctetString(Buffer.from("boot-hash-data", "utf8")), // Required in v300 and above
    }),
  }),
});

const raw = AsnConvert.serialize(keyDescription);
const rawKeyMint = AsnConvert.serialize(keyMintDescription);
```

Example of reading a non-standard KeyDescription:

```typescript
// Parse with appropriate class based on version
const keyDescription = AsnConvert.parse(raw, NonStandardKeyDescription);
const keyMintDescription = AsnConvert.parse(rawKeyMint, NonStandardKeyMintKeyDescription); // Works for both v300 and v400

// All versions support both old and new property names
console.log(keyMintDescription.keyMintVersion); // 1
console.log(keyMintDescription.keymasterVersion); // Same as keyMintVersion (1)
console.log(keyMintDescription.hardwareEnforced === keyMintDescription.teeEnforced); // true

// Check v400 specific fields
const moduleHash = keyMintDescription.hardwareEnforced.findProperty("moduleHash");
console.log(moduleHash && Buffer.from(moduleHash).toString("utf8")); // "module-hash-value"

// Converting between versions
const legacyFromKeyMint = keyMintDescription.toLegacyKeyDescription();
const keyMintFromLegacy = KeyMintKeyDescription.fromLegacyKeyDescription(legacyFromKeyMint);
```
