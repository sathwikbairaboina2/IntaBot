/**
 * True when `text` contains `keyword` as a whole word, case-insensitively.
 * Punctuation and emoji around it are ignored; letters and digits are not,
 * so "linkedin" and "blink" do not match "LINK".
 */
export function isLinkRequest(text: string, keyword: string): boolean {
  const word = keyword.trim();
  if (!word) return false;
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "iu").test(text);
}

/** True when `text` contains any of the words; unset or empty words never match. */
export function mentionsAny(text: string, words: ReadonlyArray<string | null | undefined>): boolean {
  return words.some((word) => !!word && isLinkRequest(text, word));
}
