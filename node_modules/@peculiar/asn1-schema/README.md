# `@peculiar/asn1-schema`

[![License](https://img.shields.io/badge/license-MIT-green.svg?style=flat)](https://raw.githubusercontent.com/PeculiarVentures/asn1-schema/master/packages/schema/LICENSE.md)
[![npm version](https://badge.fury.io/js/%40peculiar%2Fasn1-schema.svg)](https://badge.fury.io/js/%40peculiar%2Fasn1-schema)

[![NPM](https://nodei.co/npm/@peculiar/asn1-schema.png)](https://nodei.co/npm/@peculiar/asn1-schema/)

This package uses ES2015 [decorators](https://medium.com/google-developers/exploring-es7-decorators-76ecb65fb841) to simplify working with ASN.1 creation and parsing. 


## Introduction

Abstract Syntax Notation One (ASN.1) is a standard interface description language for defining data structures that can be serialized and deserialized in a cross-platform way. Working with ASN.1 can be complicated as there are many ways to represent the same data and many solutions handcraft, incorrectly, the ASN.1 representation of the data.

`asn1-schema` addresses this by using decorators to make both serialization and parsing of ASN.1 possible via a simple class that handles these problems for you. 

This is important because validating input data before its use is important to do because all input data is evil. 


## Installation

Installation is handled via  `npm`:

```
$ npm install @peculiar/asn1-schema
```

## TypeScript examples
Node.js:

ASN.1 schema
```
Extension  ::=  SEQUENCE  {
  extnID      OBJECT IDENTIFIER,
  critical    BOOLEAN DEFAULT FALSE,
  extnValue   OCTET STRING
              -- contains the DER encoding of an ASN.1 value
              -- corresponding to the extension type identified
              -- by extnID
}

id-ce-basicConstraints OBJECT IDENTIFIER ::=  { id-ce 19 }

BasicConstraints ::= SEQUENCE {
  cA                      BOOLEAN DEFAULT FALSE,
  pathLenConstraint       INTEGER (0..MAX) OPTIONAL 
}
```

ASN.1 schema declaration in TypeScript project
```ts
import { Asn1Prop, Asn1PropTypes, Asn1Serializer } from "@peculiar/asn1-schema";

class Extension {

  public static CRITICAL = false;

  @AsnProp({ type: Asn1PropTypes.ObjectIdentifier })
  public extnID: string = "";

  @AsnProp({
    type: Asn1PropTypes.Boolean,
    defaultValue: Extension.CRITICAL,
  })
  public critical = Extension.CRITICAL;

  @AsnProp({ type: Asn1PropTypes.OctetString })
  public extnValue: ArrayBuffer = new ArrayBuffer(0);

}

class BasicConstraints {
  @AsnProp({ type: Asn1PropTypes.Boolean, defaultValue: false })
  public ca = false;

  @AsnProp({ type: Asn1PropTypes.Integer, optional: true })
  public pathLenConstraint?: number;
}
```

Encoding ASN.1 data
```ts
const basicConstraints = new BasicConstraints();
basicConstraints.ca = true;
basicConstraints.pathLenConstraint = 1;

const extension = new Extension();
extension.critical = true;
extension.extnID = "2.5.29.19";
extension.extnValue = AsnSerializer.serialize(basicConstraints);

console.log(Buffer.from(AsnSerializer.serialize(extension)).toString("hex")); // 30120603551d130101ff040830060101ff020101
```

[ASN.1 encoded  data](http://lapo.it/asn1js/#MBIGA1UdEwEB_wQIMAYBAf8CAQE)

Decoding ASN.1 data
```ts
const extension = AsnParser.parse(Buffer.from("30120603551d130101ff040830060101ff020101", "hex"), Extension);
console.log("Extension ID:", extension.extnID); // Extension ID: 2.5.29.19
console.log("Critical:", extension.critical); // Critical: true

const basicConstraints = AsnParser.parse(extension.extnValue, BasicConstraints);
console.log("CA:", basicConstraints.ca); // CA: true
console.log("Path length:", basicConstraints.pathLenConstraint); // Path length: 1
```
