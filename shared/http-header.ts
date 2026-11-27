/**
 * One download-header rule for every response that hands a file to the browser.
 *
 * A raw quote or backslash must never reach the header value: Node rejects CRLF with
 * ERR_INVALID_CHAR, but it passes a bare quote through, so the plain parameter has to be
 * sanitised while the exact name travels in the RFC 5987 extended parameter.
 */
export function encodedFilename(filename: string) {
  return encodeURIComponent(filename).replace(/[!'()*]/g, character =>
    '%' + character.charCodeAt(0).toString(16).toUpperCase());
}

/** Strip anything that cannot sit safely inside a quoted header value. */
export function plainFilename(value: string) {
  return value.replace(/[^\x20-\x7e]|["\\]/g, '_');
}

export function attachmentDisposition(filename: string, plain: string = filename) {
  return `attachment; filename="${plainFilename(plain)}"; filename*=UTF-8''${encodedFilename(filename)}`;
}

/** Resolve one canonical byte range against the current representation length. */
export function parseSingleByteRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || !match[1] && !match[2]) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return null;
  return { start, end };
}
