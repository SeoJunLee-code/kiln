/**
 * Take out of a JavaScript module what only a reader needs: comments, indentation,
 * blank lines, and the runs of spaces that stripped types leave behind. Line breaks
 * between statements stay (so semicolon insertion sees the same lines), and nothing
 * inside a string, a template literal or a regular expression is touched.
 *
 * This is not a minifier: names are not shortened and no token is moved, so a built
 * file still reads like its source and a stack trace still names the same functions.
 */

// After one of these words a `/` starts a regular expression, not a division.
const BEFORE_REGEX = new Set(['return', 'typeof', 'case', 'in', 'of', 'else', 'void', 'delete', 'throw', 'new', 'do', 'yield', 'await', 'instanceof']);
const WORD = /[A-Za-z0-9_$]/;

export function squeeze(code: string): string {
  const out: string[] = [];
  // One entry per template literal we are inside the `${ }` of: the depth of `{` opened there.
  const braces: number[] = [];
  const n = code.length;
  let i = 0;

  const last = (): string => out.length ? out[out.length - 1] : '\n';
  const space = (): void => { if (last() !== ' ' && last() !== '\n') out.push(' '); };
  const line = (): void => {
    if (last() === ' ') out.pop();
    if (out.length && last() !== '\n') out.push('\n');
  };
  /** Would a `/` here start a regular expression? Decided by what was written just before it. */
  const regexHere = (): boolean => {
    let j = out.length - 1;
    while (j >= 0 && (out[j] === ' ' || out[j] === '\n')) j--;
    if (j < 0) return true;
    const c = out[j];
    if (WORD.test(c)) {
      let k = j;
      while (k >= 0 && WORD.test(out[k])) k--;
      return BEFORE_REGEX.has(out.slice(k + 1, j + 1).join(''));
    }
    return c !== ')' && c !== ']';
  };
  /** Copy a quoted string starting at `i` as it is. */
  const quoted = (q: string): void => {
    out.push(code[i++]);
    while (i < n && code[i] !== q) {
      if (code[i] === '\\') out.push(code[i++]);
      out.push(code[i++]);
    }
    out.push(code[i++]);
  };
  /** Copy template text from `i` up to its closing backtick, or to a `${` (then code follows). */
  const template = (): void => {
    while (i < n) {
      const c = code[i];
      if (c === '\\') { out.push(c, code[i + 1]); i += 2; continue; }
      if (c === '`') { out.push(c); i++; return; }
      if (c === '$' && code[i + 1] === '{') { out.push('$', '{'); i += 2; braces.push(0); return; }
      out.push(c);
      i++;
    }
  };

  while (i < n) {
    const c = code[i], d = code[i + 1];
    if (c === '\n' || c === '\r') { line(); i++; continue; }
    if (c === ' ' || c === '\t') { space(); i++; continue; }
    if (c === '/' && d === '/') { while (i < n && code[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') {
      const end = code.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      if (code.slice(i, stop).includes('\n')) line(); else space();
      i = stop;
      continue;
    }
    if (c === "'" || c === '"') { quoted(c); continue; }
    if (c === '`') { out.push(c); i++; template(); continue; }
    if (c === '/' && regexHere()) {
      out.push(code[i++]);
      let cls = false;
      while (i < n && (cls || code[i] !== '/')) {
        if (code[i] === '\\') out.push(code[i++]);
        else if (code[i] === '[') cls = true;
        else if (code[i] === ']') cls = false;
        out.push(code[i++]);
      }
      out.push(code[i++]);
      continue;
    }
    if (braces.length) {
      if (c === '{') braces[braces.length - 1]++;
      else if (c === '}') {
        if (braces[braces.length - 1] === 0) { braces.pop(); out.push(c); i++; template(); continue; }
        braces[braces.length - 1]--;
      }
    }
    out.push(c);
    i++;
  }
  line();
  return out.join('');
}
