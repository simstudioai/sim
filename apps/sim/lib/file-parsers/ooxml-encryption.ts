/**
 * Detects an encrypted OOXML document. Word, Excel, and PowerPoint wrap a
 * password-protected `.docx`/`.xlsx`/`.pptx` in an OLE2 compound file whose
 * directory holds the `EncryptionInfo` and `EncryptedPackage` streams, so the
 * bytes look like a legacy binary while the ZIP package inside is unreadable.
 * The ZIP parsers and officeparser both fail on it with generic messages, which
 * is why the sniff has to recognize it up front.
 */

const OLE2_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

/** The directory sits in the first sectors; 64 KiB covers every real file. */
const DIRECTORY_SCAN_BYTES = 64 * 1024

const ENCRYPTED_PACKAGE_STREAM = Buffer.from('EncryptedPackage', 'utf16le')
const ENCRYPTION_INFO_STREAM = Buffer.from('EncryptionInfo', 'utf16le')

export function isOle2Container(buffer: Buffer): boolean {
  return buffer.length >= OLE2_SIGNATURE.length && buffer.subarray(0, 8).equals(OLE2_SIGNATURE)
}

/**
 * Whether the buffer is an OLE2 container carrying an encrypted OOXML package.
 * Bounded to the leading {@link DIRECTORY_SCAN_BYTES}; never inflates anything.
 */
export function isEncryptedOoxmlContainer(buffer: Buffer): boolean {
  if (!isOle2Container(buffer)) return false
  const head = buffer.subarray(0, DIRECTORY_SCAN_BYTES)
  return head.includes(ENCRYPTED_PACKAGE_STREAM) && head.includes(ENCRYPTION_INFO_STREAM)
}
