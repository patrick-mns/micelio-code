// Lightweight line diff (common prefix/suffix trim) shared by the workspace
// changes panel (ReviewChip) and the inline edit approval card.

export interface DiffLine {
  kind: 'same' | 'add' | 'remove';
  text: string;
  lineA: number;
  lineB: number;
}

export function computeDiff(orig: string, proposed: string): DiffLine[] {
  const oLines = orig.split('\n');
  const pLines = proposed.split('\n');
  const result: DiffLine[] = [];

  // Find common prefix
  let prefix = 0;
  while (prefix < oLines.length && prefix < pLines.length && oLines[prefix] === pLines[prefix]) {
    prefix++;
  }

  // Find common suffix
  let suffix = 0;
  while (
    suffix < oLines.length - prefix &&
    suffix < pLines.length - prefix &&
    oLines[oLines.length - 1 - suffix] === pLines[pLines.length - 1 - suffix]
  ) {
    suffix++;
  }

  // Context before
  const ctxBefore = Math.min(2, prefix);
  for (let i = prefix - ctxBefore; i < prefix; i++) {
    result.push({ kind: 'same', text: oLines[i], lineA: i + 1, lineB: i + 1 });
  }

  const oMid = oLines.slice(prefix, oLines.length - suffix);
  const pMid = pLines.slice(prefix, pLines.length - suffix);

  // Show removed + added as interleaved pairs
  const maxMid = Math.max(oMid.length, pMid.length);
  let la = prefix + 1;
  let lb = prefix + 1;
  for (let i = 0; i < maxMid; i++) {
    if (i < oMid.length) {
      result.push({ kind: 'remove', text: oMid[i], lineA: la, lineB: -1 });
      la++;
    }
    if (i < pMid.length) {
      result.push({ kind: 'add', text: pMid[i], lineA: -1, lineB: lb });
      lb++;
    }
  }

  // Context after
  const ctxAfter = Math.min(2, suffix);
  for (let i = oLines.length - suffix; i < oLines.length - suffix + ctxAfter; i++) {
    if (i < oLines.length) {
      result.push({ kind: 'same', text: oLines[i], lineA: i + 1, lineB: i + 1 });
    }
  }

  // Fallback: show all when diff is empty (files completely different)
  if (result.every((l) => l.kind === 'same') && orig !== proposed) {
    result.length = 0;
    const maxLen = Math.max(oLines.length, pLines.length);
    for (let i = 0; i < maxLen; i++) {
      const oText = oLines[i] ?? '';
      const pText = pLines[i] ?? '';
      if (oText !== pText) {
        result.push({ kind: 'remove', text: oText, lineA: i + 1, lineB: -1 });
        result.push({ kind: 'add', text: pText, lineA: -1, lineB: i + 1 });
      }
    }
  }

  return result;
}
