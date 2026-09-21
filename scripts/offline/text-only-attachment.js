import { AttachmentError, AttachmentStore } from "@deepseek-ai/dsh-attachment";

const TEXT_ONLY_IMAGE_LIMITS = Object.freeze({
	maxImageBytes: 1,
	maxImagesPerMessage: 1,
	maxMessageImageBytes: 1,
	maxImagePixels: 1,
	maxImageDimension: 1,
	mediaTypes: Object.freeze([])
});

/** Attachment service for deployments that intentionally accept text only. */
var TextOnlyAttachmentStore = class extends AttachmentStore {
	imageLimits = TEXT_ONLY_IMAGE_LIMITS;
	async validateImage() {
		throw new AttachmentError("Image attachments are disabled in this text-only deployment.", "UNSUPPORTED_IMAGE_TYPE");
	}
	async saveImage() {
		throw new AttachmentError("Image attachments are disabled in this text-only deployment.", "UNSUPPORTED_IMAGE_TYPE");
	}
	async readImage(_ref, signal) {
		signal?.throwIfAborted();
		throw new AttachmentError("Image attachments are unavailable in this text-only deployment.", "ATTACHMENT_NOT_FOUND");
	}
};

export { TEXT_ONLY_IMAGE_LIMITS, TextOnlyAttachmentStore, TextOnlyAttachmentStore as default };
