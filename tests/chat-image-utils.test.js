// ============================================================
// tests/chat-image-utils.test.js
// Pure-logic tests for chat image validation helpers.
// No DOM, no React — runs under node environment.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  CHAT_IMAGE_TYPES,
  CHAT_IMAGE_MAX_BYTES,
  validateChatImageFile,
} from '../src/lib/chatImageUtils.js';

function makeFile(type, sizeBytes) {
  return { type, size: sizeBytes };
}

describe('validateChatImageFile', () => {

  it('accepts all four Claude-vision supported image types', () => {
    for (const mimeType of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
      const result = validateChatImageFile(makeFile(mimeType, 1024));
      expect(result.ok).toBe(true);
    }
  });

  it('rejects an unsupported type (image/svg+xml)', () => {
    const result = validateChatImageFile(makeFile('image/svg+xml', 1024));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unsupported/i);
  });

  it('rejects a file exceeding 5MB', () => {
    const result = validateChatImageFile(makeFile('image/png', CHAT_IMAGE_MAX_BYTES + 1));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/5MB/i);
  });

  it('accepts a file exactly at the 5MB boundary', () => {
    const result = validateChatImageFile(makeFile('image/jpeg', CHAT_IMAGE_MAX_BYTES));
    expect(result.ok).toBe(true);
  });

});

describe('CHAT_IMAGE_TYPES', () => {

  it('contains exactly the four Claude-vision formats', () => {
    expect(CHAT_IMAGE_TYPES.has('image/png')).toBe(true);
    expect(CHAT_IMAGE_TYPES.has('image/jpeg')).toBe(true);
    expect(CHAT_IMAGE_TYPES.has('image/gif')).toBe(true);
    expect(CHAT_IMAGE_TYPES.has('image/webp')).toBe(true);
    expect(CHAT_IMAGE_TYPES.has('image/svg+xml')).toBe(false);
  });

});
