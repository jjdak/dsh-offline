import { AttachmentStore, type ImageAttachmentLimits, type ImageAttachmentRef, type SaveImageAttachment, type StoredImageAttachment } from '@deepseek-ai/dsh-attachment'

export declare const TEXT_ONLY_IMAGE_LIMITS: ImageAttachmentLimits
export declare class TextOnlyAttachmentStore extends AttachmentStore {
  readonly imageLimits: ImageAttachmentLimits
  validateImage(input: SaveImageAttachment): Promise<void>
  saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef>
  readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment>
}
export default TextOnlyAttachmentStore
