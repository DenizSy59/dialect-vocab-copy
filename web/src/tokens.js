/* Decide which token owns each character of a line.
 *
 * Shared because both the player and the subtitle companion need it and they
 * got different answers when they each did it their own way: the companion
 * rendered tokens back to back, which dropped every space between Korean and
 * Turkish words and produced an unreadable run of characters.
 *
 * Rendering by character range instead of by token means the original text is
 * reproduced exactly — spaces, punctuation and all — while each character still
 * knows which token it belongs to.
 *
 * The other reason this cannot be a simple loop over tokens: tokens overlap.
 * kiwi splits 왔 into 오/VV and 았/EP, both pointing at the same character, so
 * printing each token in turn gives 오었 where the text says 왔. Giving every
 * character exactly one owner, with content tokens winning ties, fixes both
 * problems at once.
 */
export function ownership(text, tokens) {
  const owner = new Array(text.length).fill(-1);
  const order = tokens
    .map((t, i) => ({ t, i }))
    .sort((a, b) => Number(b.t.content) - Number(a.t.content));

  for (const { t, i } of order) {
    const from = t.charStart ?? t.char_start ?? 0;
    const to = t.charEnd ?? t.char_end ?? 0;
    for (let c = from; c < to && c < text.length; c++) {
      if (owner[c] === -1) owner[c] = i;
    }
  }

  // Group runs of consecutive characters with the same owner into spans.
  const runs = [];
  let start = 0;
  for (let c = 1; c <= text.length; c++) {
    if (c === text.length || owner[c] !== owner[start]) {
      runs.push({ text: text.slice(start, c), tokenIndex: owner[start] });
      start = c;
    }
  }
  return runs;
}
