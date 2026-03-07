/**
 * Minimal Thrift binary protocol encoder/decoder for Evernote API.
 * Supports only the types needed for NoteStore operations.
 */

const THRIFT_VERSION_1 = 0x80010000
const MESSAGE_CALL = 1
const MESSAGE_EXCEPTION = 3

const TYPE_STOP = 0
const TYPE_BOOL = 2
const TYPE_I32 = 8
const TYPE_I64 = 10
const TYPE_STRING = 11
const TYPE_STRUCT = 12
const TYPE_LIST = 15

export class ThriftWriter {
  private buffer: number[] = []

  writeMessageBegin(name: string, seqId: number): void {
    this.writeI32(THRIFT_VERSION_1 | MESSAGE_CALL)
    this.writeString(name)
    this.writeI32(seqId)
  }

  writeFieldBegin(type: number, id: number): void {
    this.buffer.push(type)
    this.writeI16(id)
  }

  writeFieldStop(): void {
    this.buffer.push(TYPE_STOP)
  }

  writeString(value: string): void {
    const encoded = new TextEncoder().encode(value)
    this.writeI32(encoded.length)
    for (const byte of encoded) {
      this.buffer.push(byte)
    }
  }

  writeBool(value: boolean): void {
    this.buffer.push(value ? 1 : 0)
  }

  writeI16(value: number): void {
    this.buffer.push((value >> 8) & 0xff)
    this.buffer.push(value & 0xff)
  }

  writeI32(value: number): void {
    this.buffer.push((value >> 24) & 0xff)
    this.buffer.push((value >> 16) & 0xff)
    this.buffer.push((value >> 8) & 0xff)
    this.buffer.push(value & 0xff)
  }

  writeI64(value: bigint): void {
    const buf = new ArrayBuffer(8)
    const view = new DataView(buf)
    view.setBigInt64(0, value, false)
    for (let i = 0; i < 8; i++) {
      this.buffer.push(view.getUint8(i))
    }
  }

  writeStringField(id: number, value: string): void {
    this.writeFieldBegin(TYPE_STRING, id)
    this.writeString(value)
  }

  writeBoolField(id: number, value: boolean): void {
    this.writeFieldBegin(TYPE_BOOL, id)
    this.writeBool(value)
  }

  writeI32Field(id: number, value: number): void {
    this.writeFieldBegin(TYPE_I32, id)
    this.writeI32(value)
  }

  writeStringListField(id: number, values: string[]): void {
    this.writeFieldBegin(TYPE_LIST, id)
    this.buffer.push(TYPE_STRING)
    this.writeI32(values.length)
    for (const v of values) {
      this.writeString(v)
    }
  }

  toBuffer(): Buffer {
    return Buffer.from(this.buffer)
  }
}

export class ThriftReader {
  private view: DataView
  private pos = 0

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer)
  }

  readMessageBegin(): { name: string; type: number; seqId: number } {
    const versionAndType = this.readI32()
    const version = versionAndType & 0xffff0000
    if (version !== (THRIFT_VERSION_1 | 0)) {
      throw new Error(`Unsupported Thrift version: 0x${version.toString(16)}`)
    }
    const type = versionAndType & 0x000000ff
    const name = this.readString()
    const seqId = this.readI32()
    return { name, type, seqId }
  }

  readFieldBegin(): { type: number; id: number } {
    const type = this.view.getUint8(this.pos++)
    if (type === TYPE_STOP) {
      return { type: TYPE_STOP, id: 0 }
    }
    const id = this.view.getInt16(this.pos, false)
    this.pos += 2
    return { type, id }
  }

  readString(): string {
    const length = this.readI32()
    const bytes = new Uint8Array(this.view.buffer, this.pos, length)
    this.pos += length
    return new TextDecoder().decode(bytes)
  }

  readBool(): boolean {
    return this.view.getUint8(this.pos++) !== 0
  }

  readI32(): number {
    const value = this.view.getInt32(this.pos, false)
    this.pos += 4
    return value
  }

  readI64(): bigint {
    const value = this.view.getBigInt64(this.pos, false)
    this.pos += 8
    return value
  }

  readBinary(): Uint8Array {
    const length = this.readI32()
    const bytes = new Uint8Array(this.view.buffer, this.pos, length)
    this.pos += length
    return bytes
  }

  readListBegin(): { elementType: number; size: number } {
    const elementType = this.view.getUint8(this.pos++)
    const size = this.readI32()
    return { elementType, size }
  }

  /** Skip a value of the given Thrift type */
  skip(type: number): void {
    switch (type) {
      case TYPE_BOOL:
        this.pos += 1
        break
      case 6: // I16
        this.pos += 2
        break
      case 3: // BYTE
        this.pos += 1
        break
      case TYPE_I32:
        this.pos += 4
        break
      case TYPE_I64:
      case 4: // DOUBLE
        this.pos += 8
        break
      case TYPE_STRING: {
        const len = this.readI32()
        this.pos += len
        break
      }
      case TYPE_STRUCT:
        this.skipStruct()
        break
      case TYPE_LIST:
      case 14: {
        // SET
        const { elementType, size } = this.readListBegin()
        for (let i = 0; i < size; i++) {
          this.skip(elementType)
        }
        break
      }
      case 13: {
        // MAP
        const keyType = this.view.getUint8(this.pos++)
        const valueType = this.view.getUint8(this.pos++)
        const count = this.readI32()
        for (let i = 0; i < count; i++) {
          this.skip(keyType)
          this.skip(valueType)
        }
        break
      }
      default:
        throw new Error(`Cannot skip unknown Thrift type: ${type}`)
    }
  }

  private skipStruct(): void {
    for (;;) {
      const { type } = this.readFieldBegin()
      if (type === TYPE_STOP) break
      this.skip(type)
    }
  }

  /** Read struct fields, calling the handler for each field */
  readStruct<T>(handler: (reader: ThriftReader, fieldId: number, fieldType: number) => void): void {
    for (;;) {
      const { type, id } = this.readFieldBegin()
      if (type === TYPE_STOP) break
      handler(this, id, type)
    }
  }

  /** Check if this is an exception response */
  isException(messageType: number): boolean {
    return messageType === MESSAGE_EXCEPTION
  }

  /** Read a Thrift application exception */
  readException(): { message: string; type: number } {
    let message = ''
    let type = 0
    this.readStruct((reader, fieldId, fieldType) => {
      if (fieldId === 1 && fieldType === TYPE_STRING) {
        message = reader.readString()
      } else if (fieldId === 2 && fieldType === TYPE_I32) {
        type = reader.readI32()
      } else {
        reader.skip(fieldType)
      }
    })
    return { message, type }
  }
}

export { TYPE_BOOL, TYPE_I32, TYPE_I64, TYPE_LIST, TYPE_STOP, TYPE_STRING, TYPE_STRUCT }
