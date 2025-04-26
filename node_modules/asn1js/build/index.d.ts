/*!
 * Copyright (c) 2014, GMO GlobalSign
 * Copyright (c) 2015-2022, Peculiar Ventures
 * All rights reserved.
 * 
 * Author 2014-2019, Yury Strozhevsky
 * 
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 * 
 * * Redistributions of source code must retain the above copyright notice, this
 *   list of conditions and the following disclaimer.
 * 
 * * Redistributions in binary form must reproduce the above copyright notice, this
 *   list of conditions and the following disclaimer in the documentation and/or
 *   other materials provided with the distribution.
 * 
 * * Neither the name of the copyright holder nor the names of its
 *   contributors may be used to endorse or promote products derived from
 *   this software without specific prior written permission.
 * 
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
 * ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
 * ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 * 
 */

import * as pvtsutils from 'pvtsutils';

interface IBerConvertible {
    /**
     * Base function for converting block from BER encoded array of bytes
     * @param inputBuffer ASN.1 BER encoded array
     * @param inputOffset Offset in ASN.1 BER encoded array where decoding should be started
     * @param inputLength Maximum length of array of bytes which can be using in this function
     * @returns Offset after least decoded byte
     */
    fromBER(inputBuffer: ArrayBuffer | Uint8Array, inputOffset: number, inputLength: number): number;
    /**
     * Encoding of current ASN.1 block into ASN.1 encoded array (BER rules)
     * @param sizeOnly Flag that we need only a size of encoding, not a real array of bytes
     * @returns ASN.1 BER encoded array
     */
    toBER(sizeOnly?: boolean): ArrayBuffer;
}
interface IDerConvertible {
    /**
     * Base function for converting block from DER encoded array of bytes
     * @param inputBuffer ASN.1 DER encoded array
     * @param inputOffset Offset in ASN.1 DER encoded array where decoding should be started
     * @param inputLength Maximum length of array of bytes which can be using in this function
     * @param expectedLength Expected length of converted VALUE_HEX buffer
     * @returns Offset after least decoded byte
     */
    fromDER(inputBuffer: ArrayBuffer, inputOffset: number, inputLength: number, expectedLength?: number): number;
    /**
     * Encoding of current ASN.1 block into ASN.1 encoded array (DER rules)
     * @param sizeOnly Flag that we need only a size of encoding, not a real array of bytes
     * @returns ASN.1 DER encoded array
     */
    toDER(sizeOnly?: boolean): ArrayBuffer;
}
interface IStringConvertible {
    /**
     * Returns a string representation of an object
     * @returns String representation of the class object
     */
    toString(): string;
    /**
     * Creates a class object from the string
     * @param data Input string to convert from
     */
    fromString(data: string): void;
}
interface IDateConvertible {
    /**
     * Converts a class object into the JavaScrip Date Object
     * @returns Date object
     */
    toDate(): Date;
    /**
     * Creates a class object from the JavaScript Date object
     * @param date Date object
     */
    fromDate(date: Date): void;
}

declare class ViewWriter {
    items: ArrayBuffer[];
    /**
     * Writes buffer
     * @param buf
     */
    write(buf: ArrayBuffer): void;
    /**
     * Concatenates all buffers
     * @returns Concatenated buffer
     */
    final(): ArrayBuffer;
}

interface ILocalBaseBlock {
    blockLength: number;
    error: string;
    warnings: string[];
}
interface LocalBaseBlockJson extends ILocalBaseBlock {
    blockName: string;
    valueBeforeDecode: string;
}
interface LocalBaseBlockParams extends Partial<ILocalBaseBlock> {
    valueBeforeDecode?: pvtsutils.BufferSource;
}
interface LocalBaseBlockConstructor<T extends LocalBaseBlock = LocalBaseBlock> {
    new (...args: any[]): T;
    prototype: T;
    NAME: string;
    blockName(): string;
}
/**
 * Class used as a base block for all remaining ASN.1 classes
 */
declare class LocalBaseBlock implements ILocalBaseBlock {
    /**
     * Name of the block
     */
    static NAME: string;
    /**
     * Aux function, need to get a block name. Need to have it here for inheritance
     * @returns Returns name of the block
     */
    static blockName(): string;
    blockLength: number;
    error: string;
    warnings: string[];
    /**
     * @deprecated since version 3.0.0
     */
    get valueBeforeDecode(): ArrayBuffer;
    /**
     * @deprecated since version 3.0.0
     */
    set valueBeforeDecode(value: ArrayBuffer);
    /**
     * @since 3.0.0
     */
    valueBeforeDecodeView: Uint8Array;
    /**
     * Creates and initializes an object instance of that class
     * @param param0 Initialization parameters
     */
    constructor({ blockLength, error, warnings, valueBeforeDecode, }?: LocalBaseBlockParams);
    /**
     * Returns a JSON representation of an object
     * @returns JSON object
     */
    toJSON(): LocalBaseBlockJson;
}

interface IHexBlock {
    isHexOnly: boolean;
    valueHex: pvtsutils.BufferSource;
}
interface HexBlockJson extends Omit<IHexBlock, "valueHex"> {
    valueHex: string;
}
type HexBlockParams = Partial<IHexBlock>;
/**
 * Class used as a base block for all remaining ASN.1 classes
 */
declare function HexBlock<T extends LocalBaseBlockConstructor>(BaseClass: T): {
    new (...args: any[]): {
        isHexOnly: boolean;
        /**
         * Binary data in ArrayBuffer representation
         *
         * @deprecated since version 3.0.0
         */
        valueHex: ArrayBuffer;
        /**
         * Binary data in Uint8Array representation
         *
         * @since 3.0.0
         */
        valueHexView: Uint8Array;
        fromBER(inputBuffer: ArrayBuffer | Uint8Array, inputOffset: number, inputLength: number): number;
        toBER(sizeOnly?: boolean): ArrayBuffer;
        /**
         * Returns a JSON representation of an object
         * @returns JSON object
         */
        toJSON(): {
            isHexOnly: boolean;
            valueHex: string;
            blockName: string;
            valueBeforeDecode: string;
            blockLength: number;
            error: string;
            warnings: string[];
        };
        blockLength: number;
        error: string;
        warnings: string[];
        valueBeforeDecode: ArrayBuffer;
        valueBeforeDecodeView: Uint8Array;
    };
    NAME: string;
    blockName(): string;
} & T;

type IValueBlock = ILocalBaseBlock;
type ValueBlockParams = LocalBaseBlockParams;
type ValueBlockJson = LocalBaseBlockJson;
declare class ValueBlock extends LocalBaseBlock implements IValueBlock, IBerConvertible {
    static NAME: string;
    fromBER(_inputBuffer: ArrayBuffer | Uint8Array, _inputOffset: number, _inputLength: number): number;
    toBER(_sizeOnly?: boolean, _writer?: ViewWriter): ArrayBuffer;
}

interface ILocalIdentificationBlock {
    tagClass: number;
    tagNumber: number;
    isConstructed: boolean;
}
interface LocalIdentificationBlockParams {
    idBlock?: Partial<ILocalIdentificationBlock> & HexBlockParams;
}
interface LocalIdentificationBlockJson extends HexBlockJson, LocalBaseBlockJson, ILocalIdentificationBlock {
}
declare const LocalIdentificationBlock_base: {
    new (...args: any[]): {
        isHexOnly: boolean;
        valueHex: ArrayBuffer;
        valueHexView: Uint8Array;
        fromBER(inputBuffer: ArrayBuffer | Uint8Array, inputOffset: number, inputLength: number): number;
        toBER(sizeOnly?: boolean): ArrayBuffer;
        toJSON(): {
            isHexOnly: boolean;
            valueHex: string;
            blockName: string;
            valueBeforeDecode: string;
            blockLength: number;
            error: string;
            warnings: string[];
        };
        blockLength: number;
        error: string;
        warnings: string[];
        valueBeforeDecode: ArrayBuffer;
        valueBeforeDecodeView: Uint8Array;
    };
    NAME: string;
    blockName(): string;
} & typeof LocalBaseBlock;
declare class LocalIdentificationBlock extends LocalIdentificationBlock_base implements ILocalIdentificationBlock {
    static NAME: string;
    tagClass: number;
    tagNumber: number;
    isConstructed: boolean;
    constructor({ idBlock }?: LocalIdentificationBlockParams);
    toBER(sizeOnly?: boolean): ArrayBuffer;
    fromBER(inputBuffer: ArrayBuffer | Uint8Array, inputOffset: number, inputLength: number): number;
    toJSON(): LocalIdentificationBlockJson;
}
interface LocalIdentificationBlock {
    /**
     * @deprecated since version 3.0.0
     */
    valueBeforeDecode: ArrayBuffer;
    /**
     * Binary data in ArrayBuffer representation
     *
     * @deprecated since version 3.0.0
     */
    valueHex: ArrayBuffer;
}

interface ILocalLengthBlock {
    isIndefiniteForm: boolean;
    longFormUsed: boolean;
    length: number;
}
interface LocalLengthBlockParams {
    lenBlock?: Partial<ILocalLengthBlock>;
}
interface LocalLengthBlockJson extends LocalBaseBlockJson, ILocalLengthBlock {
    isIndefiniteForm: boolean;
    longFormUsed: boolean;
    length: number;
}
declare class LocalLengthBlock extends LocalBaseBlock implements ILocalLengthBlock, IBerConvertible {
    static NAME: string;
    isIndefiniteForm: boolean;
    longFormUsed: boolean;
    length: number;
    constructor({ lenBlock }?: LocalLengthBlockParams);
    fromBER(inputBuffer: ArrayBuffer | Uint8Array, inputOffset: number, inputLength: number): number;
    toBER(sizeOnly?: boolean): ArrayBuffer;
    toJSON(): LocalLengthBlockJson;
}

interface IBaseBlock {
    name: string;
    optional: boolean;
    primitiveSchema?: BaseBlock;
}
interface BaseBlockParams extends LocalBaseBlockParams, LocalIdentificationBlockParams, LocalLengthBlockParams, Partial<IBaseBlock> {
}
type ValueBlockConstructor<T extends ValueBlock = ValueBlock> = new (...args: any[]) => T;
interface BaseBlockJson<T extends LocalBaseBlockJson = LocalBaseBlockJson> extends LocalBaseBlockJson, Omit<IBaseBlock, "primitiveSchema"> {
    idBlock: LocalIdentificationBlockJson;
    lenBlock: LocalLengthBlockJson;
    valueBlock: T;
    primitiveSchema?: BaseBlockJson;
}
type StringEncoding = "ascii" | "hex";
declare class BaseBlock<T extends ValueBlock = ValueBlock, J extends ValueBlockJson = ValueBlockJson> extends LocalBaseBlock implements IBaseBlock, IBerConvertible {
    static NAME: string;
    idBlock: LocalIdentificationBlock;
    lenBlock: LocalLengthBlock;
    valueBlock: T;
    name: string;
    optional: boolean;
    primitiveSchema?: BaseBlock;
    constructor({ name, optional, primitiveSchema, ...parameters }?: BaseBlockParams, valueBlockType?: ValueBlockConstructor<T>);
    fromBER(inputBuffer: Uint8Array, inputOffset: number, inputLength: number): number;
    toBER(sizeOnly?: boolean, writer?: ViewWriter): ArrayBuffer;
    toJSON(): BaseBlockJson<J>;
    toString(encoding?: StringEncoding): string;
    protected onAsciiEncoding(): string;
    /**
     * Determines whether two object instances are equal
     * @param other Object to compare with the current object
     */
    isEqual(other: unknown): other is this;
}

type LocalSimpleStringValueBlockParams = LocalStringValueBlockParams;
type LocalSimpleStringValueBlockJson = LocalStringValueBlockJson;
declare class LocalSimpleStringValueBlock extends LocalStringValueBlock {
    static NAME: string;
}

interface LocalSimpleStringBlockParams extends BaseBlockParams, LocalSimpleStringValueBlockParams {
}
type LocalSimpleStringBlockJson = LocalSimpleStringValueBlockJson;
declare class LocalSimpleStringBlock extends BaseStringBlock<LocalSimpleStringValueBlock, LocalSimpleStringValueBlockJson> {
    static NAME: string;
    constructor({ ...parameters }?: LocalSimpleStringBlockParams);
    fromBuffer(inputBuffer: ArrayBuffer | Uint8Array): void;
    fromString(inputString: string): void;
}

type LocalUtf8StringValueBlockParams = LocalSimpleStringBlockParams;
type LocalUtf8StringValueBlockJson = LocalSimpleStringBlockJson;
declare class LocalUtf8StringValueBlock extends LocalSimpleStringBlock {
    static NAME: string;
    fromBuffer(inputBuffer: ArrayBuffer | Uint8Array): void;
    fromString(inputString: string): void;
}

interface ILocalStringValueBlock {
    value: string;
}
interface LocalStringValueBlockParams extends Omit<HexBlockParams, "isHexOnly">, ValueBlockParams, Partial<ILocalStringValueBlock> {
}
interface LocalStringValueBlockJson extends HexBlockJson, ValueBlockJson, ILocalStringValueBlock {
}
declare const LocalStringValueBlock_base: {
    new (...args: any[]): {
        isHexOnly: boolean;
        valueHex: ArrayBuffer;
        valueHexView: Uint8Array;
        fromBER(inputBuffer: ArrayBuffer | Uint8Array, inputOffset: number, inputLength: number): number;
        toBER(sizeOnly?: boolean): ArrayBuffer;
        toJSON(): {
            isHexOnly: boolean;
            valueHex: string;
            blockName: string;
            valueBeforeDecode: string;
            blockLength: number;
            error: string;
            warnings: string[];
        };
        blockLength: number;
        error: string;
        warnings: string[];
        valueBeforeDecode: ArrayBuffer;
        valueBeforeDecodeView: Uint8Array;
    };
    NAME: string;
    blockName(): string;
} & typeof ValueBlock;
declare abstract class LocalStringValueBlock extends LocalStringValueBlock_base implements ILocalStringValueBlock {
    static NAME: string;
    value: string;
    constructor({ ...parameters }?: LocalUtf8StringValueBlockParams);
    toJSON(): LocalUtf8StringValueBlockJson;
}
interface LocalStringValueBlock {
    /**
     * @deprecated since version 3.0.0
     */
    valueBeforeDecode: ArrayBuffer;
    /**
     * Binary data in ArrayBuffer representation
     *
     * @deprecated since version 3.0.0
     */
    valueHex: ArrayBuffer;
}

interface BaseStringBlockParams extends BaseBlockParams, LocalStringValueBlockParams {
}
type BaseStringBlockJson = LocalStringValueBlockJson;
declare abstract class BaseStringBlock<T extends LocalStringValueBlock = LocalStringValueBlock, J extends BaseStringBlockJson = BaseStringBlockJson> extends BaseBlock<T, J> implements IStringConvertible {
    static NAME: string;
    /**
     * String value
     * @since 3.0.0
     */
    getValue(): string;
    /**
     * String value
     * @param value String value
     * @since 3.0.0
     */
    setValue(value: string): void;
    constructor({ value, ...parameters }: BaseStringBlockParams | undefined, stringValueBlockType: new () => T);
    fromBER(inputBuffer: ArrayBuffer | Uint8Array, inputOffset: number, inputLength: number): number;
    /**
     * Function converting ArrayBuffer into ASN.1 internal string
     * @param inputBuffer ASN.1 BER encoded array
     */
    abstract fromBuffer(inputBuffer: ArrayBuffer | Uint8Array): void;
    abstract fromString(inputString: string): void;
    protected onAsciiEncoding(): string;
}

interface LocalPrimitiveValueBlockParams extends HexBlockParams, ValueBlockParams {
}
interface LocalPrimitiveValueBlockJson extends HexBlockJson, ValueBlockJson {
}
declare const LocalPrimitiveValueBlock_base: {
    new (...args: any[]): {
        isHexOnly: boolean;
        valueHex: ArrayBuffer;
        valueHexView: Uint8Array;
        fromBER(inputBuffer: ArrayBuffer | Uint8Array, inputOffset: number, inputLength: number): number;
        toBER(sizeOnly?: boolean): ArrayBuffer;
        toJSON(): {
            isHexOnly: boolean;
            valueHex: string;
            blockName: string;
            valueBeforeDecode: string;
            blockLength: number;
            error: string;
            warnings: string[];
        };
        blockLength: number;
        error: string;
        warnings: string[];
        valueBeforeDecode: ArrayBuffer;
        valueBeforeDecodeView: Uint8Array;
    };
    NAME: string;
    blockName(): string;
} & typeof ValueBlock;
declare class LocalPrimitiveValueBlock extends LocalPrimitiveValueBlock_base {
    static NAME: string;
    constructor({ isHexOnly, ...parameters }?: LocalPrimitiveValueBlockParams);
}
interface LocalPrimitiveValueBlock {
    /**
     * @deprecated since version 3.0.0
     */
    valueBeforeDecode: ArrayBuffer;
    /**
     * Binary data in ArrayBuffer representation
     *
     * @deprecated since version 3.0.0
     */
    valueHex: ArrayBuffer;
}

interface PrimitiveParams extends BaseBlockParams, LocalPrimitiveValueBlockParams {
}
type PrimitiveJson = BaseBlockJson<LocalPrimitiveValueBlockJson>;
declare class Primitive extends BaseBlock<LocalPrimitiveValueBlock, LocalPrimitiveValueBlockJson> {
    static NAME: string;
    constructor(parameters?: PrimitiveParams);
}

interface IAny {
    name: string;
    optional: boolean;
}
type AnyParams = Partial<IAny>;
declare class Any implements IAny {
    name: string;
    optional: boolean;
    constructor({ name, optional }?: AnyParams);
}

type ConstructedItem = BaseBlock | Any;
interface ILocalConstructedValueBlock {
    value: ConstructedItem[];
    isIndefiniteForm: boolean;
}
interface LocalConstructedValueBlockParams extends ValueBlockParams, Partial<ILocalConstructedValueBlock> {
}
interface LocalConstructedValueBlockJson extends LocalBaseBlockJson, Omit<ILocalConstructedValueBlock, "value"> {
    value: LocalBaseBlockJson[];
}
declare class LocalConstructedValueBlock extends ValueBlock implements ILocalConstructedValueBlock {
    static NAME: string;
    value: BaseBlock[];
    isIndefiniteForm: boolean;
    constructor({ value, isIndefiniteForm, ...parameters }?: LocalConstructedValueBlockParams);
    fromBER(inputBuffer: ArrayBuffer | Uint8Array, inputOffset: number, inputLength: number): number;
    toBER(sizeOnly?: boolean, writer?: ViewWriter): ArrayBuffer;
    toJSON(): LocalConstructedValueBlockJson;
}

interface ConstructedParams extends BaseBlockParams, LocalConstructedValueBlockParams {
}
type ConstructedJson = BaseBlockJson<LocalConstructedValueBlockJson>;
declare class Constructed extends BaseBlock<LocalConstructedValueBlock, LocalConstructedValueBlockJson> {
    static NAME: string;
    constructor(parameters?: ConstructedParams);
    fromBER(inputBuffer: ArrayBuffer | Uint8Array, inputOffset: number, inputLength: number): number;
}

declare class LocalEndOfContentValueBlock extends ValueBlock {
    static override: string;
    fromBER(inputBuffer: ArrayBuffer | Uint8Array, inputOffset: number, _inputLength: number): number;
    toBER(_sizeOnly?: boolean): ArrayBuffer;
}

type EndOfContentParams = BaseBlockParams;
type EndOfContentJson = BaseBlockJson;
declare class EndOfContent extends BaseBlock<LocalEndOfContentValueBlock> {
    static NAME: string;
    constructor(parameters?: EndOfContentParams);
}

type NullParams = BaseBlockParams;
type NullJson = BaseBlockJson<ValueBlockJson>;
declare class Null extends BaseBlock<ValueBlock, ValueBlockJson> {
    static NAME: string;
    constructor(parameters?: NullParams);
    fromBER(inputBuffer: ArrayBuffer | Uint8Array, inputOffset: number, inputLength: number): number;
    toBER(sizeOnly?: boolean, writer?: ViewWriter): ArrayBuffer;
    protected onAsciiEncoding(): string;
}

interface ILocalBooleanValueBlock {
    value: boolean;
}
interface LocalBooleanValueBlockParams extends ValueBlockParams, HexBlockParams, Partial<ILocalBooleanValueBlock> {
}
interface LocalBooleanValueBlockJson extends ValueBlockJson, HexBlockJson, ILocalBooleanValueBlock {
}
declare const LocalBooleanValueBlock_base: {
    new (...args: any[]): {
        isHexOnly: boolean;
        valueHex: ArrayBuffer;
        valueHexView: Uint8Array;
        fromBER(inputBuffer: ArrayBuffer | Uint8Array, inputOffset: number, inputLength: number): number;
        toBER(sizeOnly?: boolean): ArrayBuffer;
        toJSON(): {
            isHexOnly: boolean;
            valueHex: string;
            blockName: string;
            valueBeforeDecode: string;
            blockLength: number;
            error: string;
            warnings: string[];
        };
        blockLength: number;
        error: string;
        warnings: string[];
        valueBeforeDecode: ArrayBuffer;
        valueBeforeDecodeView: Uint8Array;
    };
    NAME: string;
    blockName(): string;
} & typeof ValueBlock;
declare class LocalBooleanValueBlock extends LocalBooleanValueBlock_base implements ILocalBooleanValueBlock {
    static NAME: string;
    get value(): boolean;
    set value(value: boolean);
    constructor({ value, ...parameters }?: LocalBooleanValueBlockParams);
    fromBER(inputBuffer: ArrayBuffer | Uint8Array, inputOffset: number, inputLength: number): number;
    toBER(): ArrayBuffer;
    toJSON(): LocalBooleanValueBlockJson;
}
interface LocalBooleanValueBlock {
    /**
     * @deprecated since version 3.0.0
     */
    valueBeforeDecode: ArrayBuffer;
    /**
     * Binary data in ArrayBuffer representation
     *
     * @deprecated since version 3.0.0
     */
    valueHex: ArrayBuffer;
}

interface BooleanParams extends BaseBlockParams, LocalBooleanValueBlockParams {
}
type BooleanJson = BaseBlockJson<LocalBooleanValueBlockJson>;
declare class Boolean extends BaseBlock<LocalBooleanValueBlock, LocalBooleanValueBlockJson> {
    /**
     * Gets value
     * @since 3.0.0
     */
    getValue(): boolean;
    /**
     * Sets value
     * @param value Boolean value
     * @since 3.0.0
     */
    setValue(value: boolean): void;
    static NAME: string;
    constructor(parameters?: BooleanParams);
    protected onAsciiEncoding(): string;
}

interface ILocalOctetStringValueBlock {
    isConstructed: boolean;
}
interface LocalOctetStringValueBlockParams extends HexBlockParams, LocalConstructedValueBlockParams, Partial<ILocalOctetStringValueBlock> {
    value?: OctetString[];
}
interface LocalOctetStringValueBlockJson extends HexBlockJson, LocalConstructedValueBlockJson, ILocalOctetStringValueBlock {
}
declare const LocalOctetStringValueBlock_base: {
    new (...args: any[]): {
        isHexOnly: boolean;
        valueHex: ArrayBuffer;
        valueHexView: Uint8Array;
        fromBER(inputBuffer: ArrayBuffer | Uint8Array, inputOffset: number, inputLength: number): number;
        toBER(sizeOnly?: boolean): ArrayBuffer;
        toJSON(): {
            isHexOnly: boolean;
            valueHex: string;
            blockName: string;
            valueBeforeDecode: string;
            blockLength: number;
            error: string;
            warnings: string[];
        };
        blockLength: number;
        error: string;
        warnings: string[];
        valueBeforeDecode: ArrayBuffer;
        valueBeforeDecodeView: Uint8Array;
    };
    NAME: string;
    blockName(): string;
} & typeof LocalConstructedValueBlock;
declare class LocalOctetStringValueBlock extends LocalOctetStringValueBlock_base {
    static NAME: string;
    isConstructed: boolean;
    constructor({ isConstructed, ...parameters }?: LocalOctetStringValueBlockParams);
    fromBER(inputBuffer: ArrayBuffer, inputOffset: number, inputLength: number): number;
    toBER(sizeOnly?: boolean, writer?: ViewWriter): ArrayBuffer;
    toJSON(): LocalOctetStringValueBlockJson;
}
interface LocalOctetStringValueBlock {
    /**
     * @deprecated since version 3.0.0
     */
    valueBeforeDecode: ArrayBuffer;
    /**
     * Binary data in ArrayBuffer representation
     *
     * @deprecated since version 3.0.0
     */
    valueHex: ArrayBuffer;
}

interface OctetStringParams extends BaseBlockParams, LocalOctetStringValueBlockParams {
}
type OctetStringJson = BaseBlockJson<LocalOctetStringValueBlockJson>;
declare class OctetString extends BaseBlock<LocalOctetStringValueBlock, LocalOctetStringValueBlockJson> {
    static NAME: string;
    constructor({ idBlock, lenBlock, ...parameters }?: OctetStringParams);
    fromBER(inputBuffer: ArrayBuffer | Uint8Array, inputOffset: number, inputLength: number): number;
    protected onAsciiEncoding(): string;
    /**
     * Returns OctetString value. If OctetString is constructed, returns concatenated internal OctetString values
     * @returns Array buffer
     * @since 3.0.0
     */
    getValue(): ArrayBuffer;
}

interface ILocalBitStringValueBlock {
    unusedBits: number;
    isConstructed: boolean;
}
interface LocalBitStringValueBlockParams extends HexBlockParams, LocalConstructedValueBlockParams, Partial<ILocalBitStringValueBlock> {
    value?: BitString[];
}
interface LocalBitStringValueBlockJson extends HexBlockJson, LocalConstructedValueBlockJson, ILocalBitStringValueBlock {
}
declare const LocalBitStringValueBlock_base: {
    new (...args: any[]): {
        isHexOnly: boolean;
        valueHex: ArrayBuffer;
        valueHexView: Uint8Array;
        fromBER(inputBuffer: ArrayBuffer | Uint8Array, inputOffset: number, inputLength: number): number;
        toBER(sizeOnly?: boolean): ArrayBuffer;
        toJSON(): {
            isHexOnly: boolean;
            valueHex: string;
            blockName: string;
            valueBeforeDecode: string;
            blockLength: number;
            error: string;
            warnings: string[];
        };
        blockLength: number;
        error: string;
        warnings: string[];
        valueBeforeDecode: ArrayBuffer;
        valueBeforeDecodeView: Uint8Array;
    };
    NAME: string;
    blockName(): string;
} & typeof LocalConstructedValueBlock;
declare class LocalBitStringValueBlock extends LocalBitStringValueBlock_base implements ILocalBitStringValueBlock {
    static NAME: string;
    unusedBits: number;
    isConstructed: boolean;
    constructor({ unusedBits, isConstructed, ...parameters }?: LocalBitStringValueBlockParams);
    fromBER(inputBuffer: ArrayBuffer | Uint8Array, inputOffset: number, inputLength: number): number;
    toBER(sizeOnly?: boolean, writer?: ViewWriter): ArrayBuffer;
    toJSON(): LocalBitStringValueBlockJson;
}
interface LocalBitStringValueBlock {
    /**
     * @deprecated since version 3.0.0
     */
    valueBeforeDecode: ArrayBuffer;
    /**
     * Binary data in ArrayBuffer representation
     *
     * @deprecated since version 3.0.0
     */
    valueHex: ArrayBuffer;
}

interface BitStringParams extends BaseBlockParams, LocalBitStringValueBlockParams {
}
type BitStringJson = BaseBlockJson<LocalBitStringValueBlockJson>;
declare class BitString extends BaseBlock<LocalBitStringValueBlock, LocalBitStringValueBlockJson> {
    static NAME: string;
    constructor({ idBlock, lenBlock, ...parameters }?: BitStringParams);
    fromBER(inputBuffer: ArrayBuffer | Uint8Array, inputOffset: number, inputLength: number): number;
    protected onAsciiEncoding(): string;
}

interface ILocalIntegerValueBlock {
    value: number;
}
interface LocalIntegerValueBlockParams extends HexBlockParams, ValueBlockParams, Partial<ILocalIntegerValueBlock> {
}
interface LocalIntegerValueBlockJson extends HexBlockJson, ValueBlockJson {
    valueDec: number;
}
declare const LocalIntegerValueBlock_base: {
    new (...args: any[]): {
        isHexOnly: boolean;
        valueHex: ArrayBuffer;
        valueHexView: Uint8Array;
        fromBER(inputBuffer: ArrayBuffer | Uint8Array, inputOffset: number, inputLength: number): number;
        toBER(sizeOnly?: boolean): ArrayBuffer;
        toJSON(): {
            isHexOnly: boolean;
            valueHex: string;
            blockName: string;
            valueBeforeDecode: string;
            blockLength: number;
            error: string;
            warnings: string[];
        };
        blockLength: number;
        error: string;
        warnings: string[];
        valueBeforeDecode: ArrayBuffer;
        valueBeforeDecodeView: Uint8Array;
    };
    NAME: string;
    blockName(): string;
} & typeof ValueBlock;
declare class LocalIntegerValueBlock extends LocalIntegerValueBlock_base implements IDerConvertible {
    protected setValueHex(): void;
    static NAME: string;
    private _valueDec;
    constructor({ value, ...parameters }?: LocalIntegerValueBlockParams);
    set valueDec(v: number);
    get valueDec(): number;
    fromDER(inputBuffer: ArrayBuffer, inputOffset: number, inputLength: number, expectedLength?: number): number;
    toDER(sizeOnly?: boolean): ArrayBuffer;
    fromBER(inputBuffer: ArrayBuffer, inputOffset: number, inputLength: number): number;
    toBER(sizeOnly?: boolean): ArrayBuffer;
    toJSON(): LocalIntegerValueBlockJson;
    toString(): string;
}
interface LocalIntegerValueBlock {
    /**
     * @deprecated since version 3.0.0
     */
    valueBeforeDecode: ArrayBuffer;
    /**
     * Binary data in ArrayBuffer representation
     *
     * @deprecated since version 3.0.0
     */
    valueHex: ArrayBuffer;
}

interface IntegerParams extends BaseBlockParams, LocalIntegerValueBlockParams {
}
type IntegerJson = BaseBlockJson<LocalIntegerValueBlockJson>;
declare class Integer extends BaseBlock<LocalIntegerValueBlock, LocalIntegerValueBlockJson> {
    static NAME: string;
    constructor(parameters?: IntegerParams);
    /**
     * Converts Integer into BigInt
     * @throws Throws Error if BigInt is not supported
     * @since 3.0.0
     */
    toBigInt(): bigint;
    /**
     * Creates Integer from BigInt value
     * @param value BigInt value
     * @returns ASN.1 Integer
     * @throws Throws Error if BigInt is not supported
     * @since 3.0.0
     */
    static fromBigInt(value: number | string | bigint | boolean): Integer;
    convertToDER(): Integer;
    /**
     * Convert current Integer value from DER to BER format
     * @returns
     */
    convertFromDER(): Integer;
    protected onAsciiEncoding(): string;
}

type EnumeratedParams = IntegerParams;
type EnumeratedJson = IntegerJson;
declare class Enumerated extends Integer {
    static NAME: string;
    constructor(parameters?: EnumeratedParams);
}

interface ILocalSidValueBlock {
    valueDec: number;
    isFirstSid: boolean;
}
interface LocalSidValueBlockParams extends HexBlockParams, ValueBlockParams, Partial<ILocalSidValueBlock> {
}
interface LocalSidValueBlockJson extends HexBlockJson, ValueBlockJson, ILocalSidValueBlock {
}
declare const LocalSidValueBlock_base: {
    new (...args: any[]): {
        isHexOnly: boolean;
        valueHex: ArrayBuffer;
        valueHexView: Uint8Array;
        fromBER(inputBuffer: ArrayBuffer | Uint8Array, inputOffset: number, inputLength: number): number;
        toBER(sizeOnly?: boolean): ArrayBuffer;
        toJSON(): {
            isHexOnly: boolean;
            valueHex: string;
            blockName: string;
            valueBeforeDecode: string;
            blockLength: number;
            error: string;
            warnings: string[];
        };
        blockLength: number;
        error: string;
        warnings: string[];
        valueBeforeDecode: ArrayBuffer;
        valueBeforeDecodeView: Uint8Array;
    };
    NAME: string;
    blockName(): string;
} & typeof ValueBlock;
declare class LocalSidValueBlock extends LocalSidValueBlock_base implements ILocalSidValueBlock {
    static NAME: string;
    valueDec: number;
    isFirstSid: boolean;
    constructor({ valueDec, isFirstSid, ...parameters }?: LocalSidValueBlockParams);
    fromBER(inputBuffer: ArrayBuffer | Uint8Array, inputOffset: number, inputLength: number): number;
    set valueBigInt(value: bigint);
    toBER(sizeOnly?: boolean): ArrayBuffer;
    toString(): string;
    toJSON(): LocalSidValueBlockJson;
}
interface LocalSidValueBlock {
    /**
     * @deprecated since version 3.0.0
     */
    valueBeforeDecode: ArrayBuffer;
    /**
     * Binary data in ArrayBuffer representation
     *
     * @deprecated since version 3.0.0
     */
    valueHex: ArrayBuffer;
}

interface ILocalObjectIdentifierValueBlock {
    value: string;
}
interface LocalObjectIdentifierValueBlockParams extends ValueBlockParams, Partial<ILocalObjectIdentifierValueBlock> {
}
interface LocalObjectIdentifierValueBlockJson extends ValueBlockJson, ILocalObjectIdentifierValueBlock {
    sidArray: LocalSidValueBlockJson[];
}
declare class LocalObjectIdentifierValueBlock extends ValueBlock implements IStringConvertible {
    static NAME: string;
    value: LocalSidValueBlock[];
    constructor({ value, ...parameters }?: LocalObjectIdentifierValueBlockParams);
    fromBER(inputBuffer: ArrayBuffer | Uint8Array, inputOffset: number, inputLength: number): number;
    toBER(sizeOnly?: boolean): ArrayBuffer;
    fromString(string: string): void;
    toString(): string;
    toJSON(): LocalObjectIdentifierValueBlockJson;
}

interface ObjectIdentifierParams extends BaseBlockParams, LocalObjectIdentifierValueBlockParams {
}
interface ObjectIdentifierJson extends BaseBlockJson<LocalObjectIdentifierValueBlockJson> {
    value: string;
}
declare class ObjectIdentifier extends BaseBlock<LocalObjectIdentifierValueBlock, LocalObjectIdentifierValueBlockJson> {
    static NAME: string;
    /**
     * Gets string representation of Object Identifier
     * @since 3.0.0
     */
    getValue(): string;
    /**
     * Sets Object Identifier value from string
     * @param value String value
     * @since 3.0.0
     */
    setValue(value: string): void;
    constructor(parameters?: ObjectIdentifierParams);
    protected onAsciiEncoding(): string;
    toJSON(): ObjectIdentifierJson;
}

interface ILocalRelativeSidValueBlock {
    valueDec: number;
}
interface LocalRelativeSidValueBlockParams extends HexBlockParams, ValueBlockParams, Partial<ILocalRelativeSidValueBlock> {
}
interface LocalRelativeSidValueBlockJson extends HexBlockJson, ValueBlockJson, ILocalRelativeSidValueBlock {
}
declare const LocalRelativeSidValueBlock_base: {
    new (...args: any[]): {
        isHexOnly: boolean;
        valueHex: ArrayBuffer;
        valueHexView: Uint8Array;
        fromBER(inputBuffer: ArrayBuffer | Uint8Array, inputOffset: number, inputLength: number): number;
        toBER(sizeOnly?: boolean): ArrayBuffer;
        toJSON(): {
            isHexOnly: boolean;
            valueHex: string;
            blockName: string;
            valueBeforeDecode: string;
            blockLength: number;
            error: string;
            warnings: string[];
        };
        blockLength: number;
        error: string;
        warnings: string[];
        valueBeforeDecode: ArrayBuffer;
        valueBeforeDecodeView: Uint8Array;
    };
    NAME: string;
    blockName(): string;
} & typeof LocalBaseBlock;
declare class LocalRelativeSidValueBlock extends LocalRelativeSidValueBlock_base implements ILocalRelativeSidValueBlock {
    static NAME: string;
    valueDec: number;
    constructor({ valueDec, ...parameters }?: LocalRelativeSidValueBlockParams);
    fromBER(inputBuffer: ArrayBuffer | Uint8Array, inputOffset: number, inputLength: number): number;
    toBER(sizeOnly?: boolean): ArrayBuffer;
    toString(): string;
    toJSON(): LocalRelativeSidValueBlockJson;
}

interface ILocalRelativeObjectIdentifierValueBlock {
    value: string;
}
interface LocalRelativeObjectIdentifierValueBlockParams extends ValueBlockParams, Partial<ILocalRelativeObjectIdentifierValueBlock> {
}
interface LocalRelativeObjectIdentifierValueBlockJson extends ValueBlockJson, ILocalRelativeObjectIdentifierValueBlock {
    sidArray: LocalRelativeSidValueBlockJson[];
}
declare class LocalRelativeObjectIdentifierValueBlock extends ValueBlock implements IStringConvertible {
    static NAME: string;
    value: LocalRelativeSidValueBlock[];
    constructor({ value, ...parameters }?: LocalRelativeObjectIdentifierValueBlockParams);
    fromBER(inputBuffer: ArrayBuffer | Uint8Array, inputOffset: number, inputLength: number): number;
    toBER(sizeOnly?: boolean, _writer?: ViewWriter): ArrayBuffer;
    fromString(string: string): boolean;
    toString(): string;
    toJSON(): LocalRelativeObjectIdentifierValueBlockJson;
}

interface RelativeObjectIdentifierParams extends BaseBlockParams, LocalRelativeObjectIdentifierValueBlockParams {
}
interface RelativeObjectIdentifierJson extends BaseBlockJson<LocalRelativeObjectIdentifierValueBlockJson> {
    value: string;
}
declare class RelativeObjectIdentifier extends BaseBlock<LocalRelativeObjectIdentifierValueBlock, LocalRelativeObjectIdentifierValueBlockJson> {
    /**
     * Gets string representation of Relative Object Identifier
     * @since 3.0.0
     */
    getValue(): string;
    /**
     * Sets Relative Object Identifier value from string
     * @param value String value
     * @since 3.0.0
     */
    setValue(value: string): void;
    static NAME: string;
    constructor(parameters?: RelativeObjectIdentifierParams);
    protected onAsciiEncoding(): string;
    toJSON(): RelativeObjectIdentifierJson;
}

type SequenceParams = ConstructedParams;
type SequenceJson = ConstructedJson;
declare class Sequence extends Constructed {
    static NAME: string;
    constructor(parameters?: SequenceParams);
}

type SetParams = ConstructedParams;
type SetJson = ConstructedJson;
declare class Set extends Constructed {
    static NAME: string;
    constructor(parameters?: SetParams);
}

interface Utf8StringParams extends BaseStringBlockParams, LocalUtf8StringValueBlockParams {
}
type Utf8StringJson = BaseBlockJson<LocalUtf8StringValueBlockJson>;
declare class Utf8String extends LocalUtf8StringValueBlock {
    static NAME: string;
    constructor(parameters?: Utf8StringParams);
}

type LocalBmpStringValueBlockParams = LocalSimpleStringBlockParams;
type LocalBmpStringValueBlockJson = LocalSimpleStringBlockJson;
declare class LocalBmpStringValueBlock extends LocalSimpleStringBlock {
    static NAME: string;
    fromBuffer(inputBuffer: ArrayBuffer | Uint8Array): void;
    fromString(inputString: string): void;
}

type BmpStringParams = LocalBmpStringValueBlockParams;
type BmpStringJson = LocalBmpStringValueBlockJson;
declare class BmpString extends LocalBmpStringValueBlock {
    static NAME: string;
    constructor({ ...parameters }?: BmpStringParams);
}

type LocalUniversalStringValueBlockParams = LocalSimpleStringBlockParams;
type LocalUniversalStringValueBlockJson = LocalSimpleStringBlockJson;
declare class LocalUniversalStringValueBlock extends LocalSimpleStringBlock {
    static NAME: string;
    fromBuffer(inputBuffer: ArrayBuffer | Uint8Array): void;
    fromString(inputString: string): void;
}

type UniversalStringParams = LocalUniversalStringValueBlockParams;
type UniversalStringJson = LocalUniversalStringValueBlockJson;
declare class UniversalString extends LocalUniversalStringValueBlock {
    static NAME: string;
    constructor({ ...parameters }?: UniversalStringParams);
}

type NumericStringParams = LocalSimpleStringBlockParams;
type NumericStringJson = LocalSimpleStringBlockJson;
declare class NumericString extends LocalSimpleStringBlock {
    static NAME: string;
    constructor(parameters?: NumericStringParams);
}

type PrintableStringParams = LocalSimpleStringBlockParams;
type PrintableStringJson = LocalSimpleStringBlockJson;
declare class PrintableString extends LocalSimpleStringBlock {
    static NAME: string;
    constructor(parameters?: PrintableStringParams);
}

type TeletexStringParams = LocalSimpleStringBlockParams;
type TeletexStringJson = LocalSimpleStringBlockJson;
declare class TeletexString extends LocalSimpleStringBlock {
    static NAME: string;
    constructor(parameters?: TeletexStringParams);
}

type VideotexStringParams = LocalSimpleStringBlockParams;
type VideotexStringJson = LocalSimpleStringBlockJson;
declare class VideotexString extends LocalSimpleStringBlock {
    static NAME: string;
    constructor(parameters?: VideotexStringParams);
}

type IA5StringParams = LocalSimpleStringBlockParams;
type IA5StringJson = LocalSimpleStringBlockJson;
declare class IA5String extends LocalSimpleStringBlock {
    static NAME: string;
    constructor(parameters?: IA5StringParams);
}

type GraphicStringParams = LocalSimpleStringBlockParams;
type GraphicStringJson = LocalSimpleStringBlockJson;
declare class GraphicString extends LocalSimpleStringBlock {
    static NAME: string;
    constructor(parameters?: GraphicStringParams);
}

type VisibleStringParams = LocalSimpleStringBlockParams;
type VisibleStringJson = LocalSimpleStringBlockJson;
declare class VisibleString extends LocalSimpleStringBlock {
    static NAME: string;
    constructor(parameters?: VisibleStringParams);
}

type GeneralStringParams = LocalSimpleStringBlockParams;
type GeneralStringJson = LocalSimpleStringBlockJson;
declare class GeneralString extends LocalSimpleStringBlock {
    static NAME: string;
    constructor(parameters?: GeneralStringParams);
}

type CharacterStringParams = LocalSimpleStringBlockParams;
type CharacterStringJson = LocalSimpleStringBlockJson;
declare class CharacterString extends LocalSimpleStringBlock {
    static NAME: string;
    constructor(parameters?: CharacterStringParams);
}

interface IUTCTime {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
}
interface UTCTimeParams extends VisibleStringParams {
    value?: string;
    valueDate?: Date;
}
interface UTCTimeJson extends BaseBlockJson<LocalSimpleStringValueBlockJson>, IUTCTime {
}
type DateStringEncoding = StringEncoding | "iso";
declare class UTCTime extends VisibleString implements IUTCTime, IDateConvertible {
    static NAME: string;
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
    constructor({ value, valueDate, ...parameters }?: UTCTimeParams);
    fromBuffer(inputBuffer: ArrayBuffer | Uint8Array): void;
    /**
     * Function converting ASN.1 internal string into ArrayBuffer
     * @returns
     */
    toBuffer(): ArrayBuffer;
    /**
     * Function converting "Date" object into ASN.1 internal string
     * @param {!Date} inputDate JavaScript "Date" object
     */
    fromDate(inputDate: Date): void;
    toDate(): Date;
    fromString(inputString: string): void;
    toString(encoding?: DateStringEncoding): string;
    protected onAsciiEncoding(): string;
    toJSON(): UTCTimeJson;
}

interface IGeneralizedTime extends IUTCTime {
    millisecond: number;
}
type GeneralizedTimeParams = UTCTimeParams;
interface GeneralizedTimeJson extends UTCTimeJson {
    millisecond: number;
}
declare class GeneralizedTime extends UTCTime {
    static NAME: string;
    millisecond: number;
    constructor(parameters?: GeneralizedTimeParams);
    fromDate(inputDate: Date): void;
    toDate(): Date;
    fromString(inputString: string): void;
    toString(encoding?: DateStringEncoding): string;
    toJSON(): GeneralizedTimeJson;
}

type DATEParams = Utf8StringParams;
type DATEJson = Utf8StringJson;
declare class DATE extends Utf8String {
    static NAME: string;
    constructor(parameters?: DATEParams);
}

type TimeOfDayParams = Utf8StringParams;
type TimeOfDayJson = Utf8StringJson;
declare class TimeOfDay extends Utf8String {
    static NAME: string;
    constructor(parameters?: TimeOfDayParams);
}

type DateTimeParams = Utf8StringParams;
type DateTimeJson = Utf8StringJson;
declare class DateTime extends Utf8String {
    static NAME: string;
    constructor(parameters?: DateTimeParams);
}

type DurationParams = Utf8StringParams;
type DurationJson = Utf8StringJson;
declare class Duration extends Utf8String {
    static NAME: string;
    constructor(parameters?: DurationParams);
}

type TIMEParams = Utf8StringParams;
type TIMEJson = Utf8StringJson;
declare class TIME extends Utf8String {
    static NAME: string;
    constructor(parameters?: TIMEParams);
}

interface IChoice extends IAny {
    value: BaseBlock[];
}
type ChoiceParams = Partial<IChoice>;
declare class Choice extends Any implements IChoice {
    value: BaseBlock[];
    constructor({ value, ...parameters }?: ChoiceParams);
}

interface IRepeated extends IAny {
    value: Any;
    local: boolean;
}
type RepeatedParams = Partial<IRepeated>;
declare class Repeated extends Any {
    value: Any;
    local: boolean;
    constructor({ value, local, ...parameters }?: RepeatedParams);
}

interface IRawData {
    data: ArrayBuffer;
}
type RawDataParams = Partial<IRawData>;
/**
 * Special class providing ability to have "toBER/fromBER" for raw ArrayBuffer
 */
declare class RawData implements IBerConvertible {
    /**
     * @deprecated Since v3.0.0
     */
    get data(): ArrayBuffer;
    /**
     * @deprecated Since v3.0.0
     */
    set data(value: ArrayBuffer);
    /**
     * @since 3.0.0
     */
    dataView: Uint8Array;
    constructor({ data }?: RawDataParams);
    fromBER(inputBuffer: ArrayBuffer | Uint8Array, inputOffset: number, inputLength: number): number;
    toBER(_sizeOnly?: boolean): ArrayBuffer;
}

type AsnType = BaseBlock | EndOfContent | Boolean | Integer | BitString | OctetString | Null | ObjectIdentifier | Enumerated | Utf8String | RelativeObjectIdentifier | TIME | Sequence | Set | NumericString | PrintableString | TeletexString | VideotexString | IA5String | UTCTime | GeneralizedTime | GraphicString | VisibleString | GeneralString | UniversalString | CharacterString | BmpString | DATE | TimeOfDay | DateTime | Duration | Constructed | Primitive;

interface FromBerResult {
    offset: number;
    result: AsnType;
}
/**
 * Major function for decoding ASN.1 BER array into internal library structures
 * @param inputBuffer ASN.1 BER encoded array of bytes
 */
declare function fromBER(inputBuffer: pvtsutils.BufferSource): FromBerResult;

type AsnSchemaType = AsnType | Any | Choice | Repeated;
interface CompareSchemaSuccess {
    verified: true;
    result: AsnType & Record<string, any>;
}
interface CompareSchemaFail {
    verified: false;
    name?: string;
    result: AsnType | {
        error: string;
    };
}
type CompareSchemaResult = CompareSchemaSuccess | CompareSchemaFail;
/**
 * Compare of two ASN.1 object trees
 * @param root Root of input ASN.1 object tree
 * @param inputData Input ASN.1 object tree
 * @param inputSchema Input ASN.1 schema to compare with
 * @return Returns result of comparison
 */
declare function compareSchema(root: AsnType, inputData: AsnType, inputSchema: AsnSchemaType): CompareSchemaResult;
/**
 * ASN.1 schema verification for ArrayBuffer data
 * @param  inputBuffer Input BER-encoded ASN.1 data
 * @param  inputSchema Input ASN.1 schema to verify against to
 * @return
 */
declare function verifySchema(inputBuffer: pvtsutils.BufferSource, inputSchema: AsnSchemaType): CompareSchemaResult;

export { Any, BaseBlock, BaseStringBlock, BitString, BmpString, Boolean, CharacterString, Choice, Constructed, DATE, DateTime, Duration, EndOfContent, Enumerated, GeneralString, GeneralizedTime, GraphicString, HexBlock, IA5String, Integer, Null, NumericString, ObjectIdentifier, OctetString, Primitive, PrintableString, RawData, RelativeObjectIdentifier, Repeated, Sequence, Set, TIME, TeletexString, TimeOfDay, UTCTime, UniversalString, Utf8String, ValueBlock, VideotexString, ViewWriter, VisibleString, compareSchema, fromBER, verifySchema };
export type { AnyParams, AsnSchemaType, AsnType, BaseBlockJson, BaseBlockParams, BaseStringBlockJson, BaseStringBlockParams, BitStringJson, BitStringParams, BmpStringJson, BmpStringParams, BooleanJson, BooleanParams, CharacterStringJson, CharacterStringParams, ChoiceParams, CompareSchemaFail, CompareSchemaResult, CompareSchemaSuccess, ConstructedJson, ConstructedParams, DATEJson, DATEParams, DateStringEncoding, DateTimeJson, DateTimeParams, DurationJson, DurationParams, EndOfContentJson, EndOfContentParams, EnumeratedJson, EnumeratedParams, FromBerResult, GeneralStringJson, GeneralStringParams, GeneralizedTimeJson, GeneralizedTimeParams, GraphicStringJson, GraphicStringParams, HexBlockJson, HexBlockParams, IA5StringJson, IA5StringParams, IAny, IBaseBlock, IBerConvertible, IChoice, IDateConvertible, IDerConvertible, IGeneralizedTime, IHexBlock, IRawData, IRepeated, IStringConvertible, IUTCTime, IValueBlock, IntegerJson, IntegerParams, NullJson, NullParams, NumericStringJson, NumericStringParams, ObjectIdentifierJson, ObjectIdentifierParams, OctetStringJson, OctetStringParams, PrimitiveJson, PrimitiveParams, PrintableStringJson, PrintableStringParams, RawDataParams, RelativeObjectIdentifierJson, RelativeObjectIdentifierParams, RepeatedParams, SequenceJson, SequenceParams, SetJson, SetParams, StringEncoding, TIMEJson, TIMEParams, TeletexStringJson, TeletexStringParams, TimeOfDayJson, TimeOfDayParams, UTCTimeJson, UTCTimeParams, UniversalStringJson, UniversalStringParams, Utf8StringJson, Utf8StringParams, ValueBlockConstructor, ValueBlockJson, ValueBlockParams, VideotexStringJson, VideotexStringParams, VisibleStringJson, VisibleStringParams };
