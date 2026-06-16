// ============================================================
// chatImageUtils.js — pure validation helpers for chat image attachments
// No DOM, no React — safe to import in node-env tests.
// ============================================================

export const CHAT_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

export const CHAT_IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Validate a File/Blob for use as a chat image attachment.
 * Returns { ok: true } or { ok: false, error: string }.
 */
export function validateChatImageFile(file) {
  if (!file) {
    return { ok: false, error: 'No file provided' };
  }
  if (!CHAT_IMAGE_TYPES.has(file.type)) {
    return {
      ok: false,
      error: `Unsupported image type: ${file.type || '(unknown)'}. Use PNG, JPEG, GIF, or WebP.`,
    };
  }
  if (file.size > CHAT_IMAGE_MAX_BYTES) {
    return { ok: false, error: 'Image too large — max 5MB' };
  }
  return { ok: true };
}
