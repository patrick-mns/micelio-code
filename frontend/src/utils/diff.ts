// Line-level diff shared by the workspace changes panel (ReviewChip) and the
// inline edit approval card. Uses an LCS diff so the add/remove counts match
// `git diff --numstat` (removes = |orig| − LCS, adds = |proposed| − LCS) instead
// of over-counting every line between the first and last change.

export interface DiffLine {
  kind: 'same' | 'add' | 'remove';
  text: string;
  lineA: number;
  lineB: number;
}

// Above this original×proposed size an exact LCS table gets too big/slow, so we
// fall back to a plain block replace. Only hit by huge, heavily-rewritten files.
const MAX_LCS_CELLS = 4_000_000;

export function computeDiff(orig: string, proposed: string): DiffLine[] {
  const oLines = orig.split('\n');
  const pLines = proposed.split('\n');

  // Trim the common prefix/suffix so the LCS only runs on the changed region.
  let prefix = 0;
  while (prefix < oLines.length && prefix < pLines.length && oLines[prefix] === pLines[prefix]) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < oLines.length - prefix &&
    suffix < pLines.length - prefix &&
    oLines[oLines.length - 1 - suffix] === pLines[pLines.length - 1 - suffix]
  ) {
    suffix++;
  }

  const oMid = oLines.slice(prefix, oLines.length - suffix);
  const pMid = pLines.slice(prefix, pLines.length - suffix);

  const result: DiffLine[] = [];

  // Up to 2 lines of context before the change (line numbers are 1-based).
  const ctxBefore = Math.min(2, prefix);
  for (let i = prefix - ctxBefore; i < prefix; i++) {
    result.push({ kind: 'same', text: oLines[i], lineA: i + 1, lineB: i + 1 });
  }

  result.push(...diffMiddle(oMid, pMid, prefix));

  // Up to 2 lines of context after the change.
  const ctxAfter = Math.min(2, suffix);
  const afterStart = oLines.length - suffix;
  for (let i = afterStart; i < afterStart + ctxAfter; i++) {
    result.push({ kind: 'same', text: oLines[i], lineA: i + 1, lineB: i + 1 });
  }

  return result;
}

// LCS diff of the changed region. `offset` is the number of common prefix lines,
// used to recover absolute (1-based) line numbers for both sides.
function diffMiddle(a: string[], b: string[], offset: number): DiffLine[] {
  const n = a.length;
  const m = b.length;
  const out: DiffLine[] = [];

  if (n === 0 && m === 0) return out;

  // Too large for an exact table — remove-all then add-all (counts approximate).
  if (n * m > MAX_LCS_CELLS) {
    for (let i = 0; i < n; i++) out.push({ kind: 'remove', text: a[i], lineA: offset + i + 1, lineB: -1 });
    for (let j = 0; j < m; j++) out.push({ kind: 'add', text: b[j], lineA: -1, lineB: offset + j + 1 });
    return out;
  }

  // dp[i][j] = LCS length of a[i..] and b[j..].
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  // Walk the table, emitting same/remove/add.
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i], lineA: offset + i + 1, lineB: offset + j + 1 });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: 'remove', text: a[i], lineA: offset + i + 1, lineB: -1 });
      i++;
    } else {
      out.push({ kind: 'add', text: b[j], lineA: -1, lineB: offset + j + 1 });
      j++;
    }
  }
  while (i < n) { out.push({ kind: 'remove', text: a[i], lineA: offset + i + 1, lineB: -1 }); i++; }
  while (j < m) { out.push({ kind: 'add', text: b[j], lineA: -1, lineB: offset + j + 1 }); j++; }

  return out;
}
