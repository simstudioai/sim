/**
 * A mask tile is sized to the element box and `mask-repeat` initially repeats, so
 * anything drawn past that box lands in the next tile at the opaque head of the
 * gradient. Every fade pins `no-repeat` rather than relying on its subject
 * happening to fit inside the frame.
 */
export const MASK_NO_REPEAT = '[-webkit-mask-repeat:no-repeat] [mask-repeat:no-repeat]'
