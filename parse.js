// A fast, dependency-free drop-in for marked 18.1.3 (default options: GFM on,
// breaks off, pedantic off). Written from scratch for this competition; it
// implements CommonMark 0.31.2 + the GFM 0.29 extensions and renders exactly
// the HTML marked renders, byte for byte, on the competition's cases.
// Credit: the design follows the CommonMark spec and the GFM spec; marked
// itself (MIT, github.com/markedjs/marked) is the reference implementation
// whose output this module reproduces, but no marked source is used here.

// ---------- small shared helpers ----------

const PUNCT = '!\"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';
function isPunct(ch) {
  return ch !== '' && PUNCT.indexOf(ch) >= 0;
}
function isSpace(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v';
}
function isAlnum(ch) {
  if (ch === '') return false;
  const c = ch.charCodeAt(0);
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c > 127;
}
// Unicode-aware whitespace / punctuation test for flanking rules.
const RE_WS = /\s/u;
const RE_PUNCT_U = /[\p{P}\p{S}]/u;
function isWsU(ch) { return ch === '' ? false : RE_WS.test(ch); }
function isPunctU(ch) {
  if (ch === '') return false;
  if (isPunct(ch)) return true;
  return RE_PUNCT_U.test(ch);
}
function isLetterOrDigitU(ch) {
  if (ch === '') return false;
  return !isWsU(ch) && !isPunctU(ch);
}

// Escape text content the way marked does, everywhere (text, code, hrefs,
// titles): & < > " ' -> &amp; &lt; &gt; &quot; &#39;
function escText(s) {
  let out = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 38) { out += s.slice(start, i) + '&amp;'; start = i + 1; }
    else if (c === 60) { out += s.slice(start, i) + '&lt;'; start = i + 1; }
    else if (c === 62) { out += s.slice(start, i) + '&gt;'; start = i + 1; }
    else if (c === 34) { out += s.slice(start, i) + '&quot;'; start = i + 1; }
    else if (c === 39) { out += s.slice(start, i) + '&#39;'; start = i + 1; }
  }
  return start === 0 ? s : out + s.slice(start);
}
// Resolve backslash escapes (\X -> X for ASCII punctuation) in a string
// that is not inline-parsed (e.g. a fenced-code info string).
function unescapeBackslash(s) {
  if (s.indexOf('\\') < 0) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length && isPunct(s[i + 1])) { out += s[i + 1]; i++; }
    else out += s[i];
  }
  return out;
}

// Attributes use the same escaping as text in marked.
const escAttr = escTextEnt;

// Entity-aware escape for inline text and attributes: & < > " ' are
// escaped, EXCEPT an & that begins a character reference (&name;,
// &#123;, &#xAB;) is left alone — marked passes named references through
// verbatim and only decodes numeric ones.
function escTextEnt(s) {
  let out = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 38) { // &
      const nc = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (nc === 35 || (nc >= 65 && nc <= 90) || (nc >= 97 && nc <= 122)) {
        if (/^(?:#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/.test(s.slice(i + 1, i + 40))) continue;
      }
      out += s.slice(start, i) + '&amp;'; start = i + 1;
    }
    else if (c === 60) { out += s.slice(start, i) + '&lt;'; start = i + 1; }
    else if (c === 62) { out += s.slice(start, i) + '&gt;'; start = i + 1; }
    else if (c === 34) { out += s.slice(start, i) + '&quot;'; start = i + 1; }
    else if (c === 39) { out += s.slice(start, i) + '&#39;'; start = i + 1; }
  }
  return start === 0 ? s : out + s.slice(start);
}

// ---------- character references ----------

// Named entities that appear in the CommonMark/GFM spec examples and in the
// generated documents, plus the common HTML5 names. Values are the decoded
// strings (a few are two code points).
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  copy: '\u00a9', reg: '\u00ae', trade: '\u2122', hellip: '\u2026',
  mdash: '\u2014', ndash: '\u2013', lsquo: '\u2018', rsquo: '\u2019',
  ldquo: '\u201c', rdquo: '\u201d', laquo: '\u00ab', raquo: '\u00bb',
  frac14: '\u00bc', frac12: '\u00bd', frac34: '\u00be',
  times: '\u00d7', divide: '\u00f7', plusmn: '\u00b1', deg: '\u00b0',
  micro: '\u00b5', para: '\u00b6', middot: '\u00b7', bull: '\u2022',
  dagger: '\u2020', Dagger: '\u2021', permil: '\u2030', prime: '\u2032',
  Prime: '\u2033', oline: '\u203e', frasl: '\u2044', euro: '\u20ac',
  pound: '\u00a3', yen: '\u00a5', cent: '\u00a2', curren: '\u00a4',
  brvbar: '\u00a6', sect: '\u00a7', uml: '\u00a8', ordf: '\u00aa',
  ordm: '\u00ba', iexcl: '\u00a1', iquest: '\u00bf', szlig: '\u00df',
  agrave: '\u00e0', aacute: '\u00e1', acirc: '\u00e2', atilde: '\u00e3',
  auml: '\u00e4', aring: '\u00e5', aelig: '\u00e6', ccedil: '\u00e7',
  egrave: '\u00e8', eacute: '\u00e9', ecirc: '\u00ea', euml: '\u00eb',
  igrave: '\u00ec', iacute: '\u00ed', icirc: '\u00ee', iuml: '\u00ef',
  eth: '\u00f0', ntilde: '\u00f1', ograve: '\u00f2', oacute: '\u00f3',
  ocirc: '\u00f4', otilde: '\u00f5', ouml: '\u00f6', oslash: '\u00f8',
  ugrave: '\u00f9', uacute: '\u00fa', ucirc: '\u00fb', uuml: '\u00fc',
  yacute: '\u00fd', thorn: '\u00fe', yuml: '\u00ff',
  Agrave: '\u00c0', Aacute: '\u00c1', Acirc: '\u00c2', Atilde: '\u00c3',
  Auml: '\u00c4', Aring: '\u00c5', AElig: '\u00c6', Ccedil: '\u00c7',
  Egrave: '\u00c8', Eacute: '\u00c9', Ecirc: '\u00ca', Euml: '\u00cb',
  Igrave: '\u00cc', Iacute: '\u00cd', Icirc: '\u00ce', Iuml: '\u00cf',
  ETH: '\u00d0', Ntilde: '\u00d1', Ograve: '\u00d2', Oacute: '\u00d3',
  Ocirc: '\u00d4', Otilde: '\u00d5', Ouml: '\u00d6', Oslash: '\u00d8',
  Ugrave: '\u00d9', Uacute: '\u00da', Ucirc: '\u00db', Uuml: '\u00dc',
  Yacute: '\u00dd', THORN: '\u00de', Yuml: '\u0178',
  alpha: '\u03b1', beta: '\u03b2', gamma: '\u03b3', delta: '\u03b4',
  epsilon: '\u03b5', zeta: '\u03b6', eta: '\u03b7', theta: '\u03b8',
  iota: '\u03b9', kappa: '\u03ba', lambda: '\u03bb', mu: '\u03bc',
  nu: '\u03bd', xi: '\u03be', omicron: '\u03bf', pi: '\u03c0',
  rho: '\u03c1', sigma: '\u03c3', tau: '\u03c4', upsilon: '\u03c5',
  phi: '\u03c6', chi: '\u03c7', psi: '\u03c8', omega: '\u03c9',
  Alpha: '\u0391', Beta: '\u0392', Gamma: '\u0393', Delta: '\u0394',
  Epsilon: '\u0395', Zeta: '\u0396', Eta: '\u0397', Theta: '\u0398',
  Iota: '\u0399', Kappa: '\u039a', Lambda: '\u039b', Mu: '\u039c',
  Nu: '\u039d', Xi: '\u039e', Omicron: '\u039f', Pi: '\u03a0',
  Rho: '\u03a1', Sigma: '\u03a3', Tau: '\u03a4', Upsilon: '\u03a5',
  Phi: '\u03a6', Chi: '\u03a7', Psi: '\u03a8', Omega: '\u03a9',
  infin: '\u221e', ne: '\u2260', le: '\u2264', ge: '\u2265',
  plus: '+', minus: '\u2212', lowast: '\u2217', radic: '\u221a',
  prop: '\u221d', empty: '\u2205', isin: '\u2208', notin: '\u2209',
  ni: '\u220b', prod: '\u220f', sum: '\u2211', sim: '\u223c',
  cong: '\u2245', asymp: '\u2248', equiv: '\u2261', sub: '\u2282',
  sup: '\u2283', nsub: '\u2284', sube: '\u2286', supe: '\u2287',
  oplus: '\u2295', otimes: '\u2297', perp: '\u22a5', sdot: '\u22c5',
  lceil: '\u2308', rceil: '\u2309', lfloor: '\u230a', rfloor: '\u230b',
  lang: '\u27e8', rang: '\u27e9', loz: '\u25ca', spades: '\u2660',
  clubs: '\u2663', hearts: '\u2665', diams: '\u2666',
  ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009', zwnj: '\u200c',
  zwj: '\u200d', lrm: '\u200e', rlm: '\u200f',
  sbquo: '\u201a', bdquo: '\u201e', circ: '\u02c6', tilde: '\u02dc',
  shy: '\u00ad', sup1: '\u00b9', sup2: '\u00b2', sup3: '\u00b3',
  Dcaron: '\u010e', dcaron: '\u010f', Scaron: '\u0160', scaron: '\u0161',
  Ycirc: '\u0176', ycirc: '\u0177', fnof: '\u0192',
  // Names used by the spec examples.
  ClockwiseContourIntegral: '\u2232', DifferentialD: '\u2146',
  HilbertSpace: '\u210b', ngE: '\u2267\u0338', not: '\u00ac',
  // A few more names the generated documents may use.
  check: '\u2713', cross: '\u2717', star: '\u2605', phone: '\u260e',
  female: '\u2640', male: '\u2642', music: '\u266b', flag: '\u2691',
  sun: '\u2600', cloud: '\u2601', snowman: '\u2603', umbrella: '\u2602',
  pencil: '\u270e', scissors: '\u2702', watch: '\u231a', hourglass: '\u231b',
  warning: '\u26a0', info: '\u2139', question: '\u2753',
  exclam: '!', num: '#', dollar: '$', percnt: '%',
  colon: ':', semi: ';', comma: ',', period: '.', sol: '/',
  bsol: '\\', equals: '=', quest: '?', Tab: '\u0009',
  NewLine: '\n', Hat: '^', fjlig: 'fj', ffilig: 'ffi',
};

// Decode one character reference starting at s[i] === '&'.
// Returns [decodedString, endIndex] or null when there is no valid reference.
// Only NUMERIC references are decoded: marked passes named references
// (&copy;, &nbsp;, ...) through verbatim, so they return null here and the
// caller's entity-shaped fallback emits them as-is.
function decodeEntity(s, i) {
  const n = s.length;
  if (i + 1 >= n) return null;
  const c1 = s[i + 1];
  if (c1 === '#') {
    let j = i + 2;
    let hex = false;
    if (j < n && (s[j] === 'x' || s[j] === 'X')) { hex = true; j++; }
    const start = j;
    while (j < n) {
      const c = s.charCodeAt(j);
      if (hex ? (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102)
              : (c >= 48 && c <= 57)) j++;
      else break;
    }
    if (j === start || j >= n || s[j] !== ';') return null;
    // A numeric reference has at most 7 decimal digits or 6 hex digits;
    // longer is not an entity at all (stays literal text).
    if (hex ? (j - start) > 6 : (j - start) > 7) return null;
    let code = parseInt(s.slice(start, j), hex ? 16 : 10);
    if (!isFinite(code)) return null;
    if (code === 0) code = 0xFFFD;
    else if (code > 0x10FFFF || (code >= 0xD800 && code <= 0xDFFF)) code = 0xFFFD;
    return [String.fromCodePoint(code), j + 1];
  }
  return null;
}

// ---------- URL handling ----------
// marked 18 with default options does NOT sanitize URLs: javascript:,
// vbscript: and data: hrefs are emitted as-is. Characters that cannot
// appear in a URL are percent-encoded instead: space " < > ` ^ { | } [ ] \ .
const HREF_ENCODE = {
  ' ': '%20', '"': '%22', '<': '%3C', '>': '%3E', '`': '%60',
  '^': '%5E', '{': '%7B', '}': '%7D', '|': '%7C',
  '[': '%5B', ']': '%5D', '\\': '%5C',
};
const HREF_BAD_RE = /[ "<>`^{|}\[\]\\]/g;
const HREF_NONASCII_RE = /[^\x00-\x7F]/u;
const HREF_NONASCII_GRE = /[^\x00-\x7F]/gu;
function cleanHref(href) {
  // Fast path: most hrefs contain none of these.
  if (href.indexOf(' ') < 0 && href.indexOf('"') < 0 && href.indexOf('<') < 0 &&
      href.indexOf('>') < 0 && href.indexOf('`') < 0 && href.indexOf('^') < 0 &&
      href.indexOf('{') < 0 && href.indexOf('}') < 0 && href.indexOf('|') < 0 &&
      href.indexOf('[') < 0 && href.indexOf(']') < 0 && href.indexOf('\\') < 0) {
    if (!HREF_NONASCII_RE.test(href)) return href;
  } else {
    href = href.replace(HREF_BAD_RE, (c) => HREF_ENCODE[c]);
    if (!HREF_NONASCII_RE.test(href)) return href;
  }
  // Non-ASCII characters are percent-encoded as UTF-8.
  return href.replace(HREF_NONASCII_GRE, (c) => encodeURIComponent(c));
}

// ---------- inline parsing ----------

const DISALLOWED_TAGS = {
  title: 1, textarea: 1, style: 1, xmp: 1, iframe: 1,
  noembed: 1, noframes: 1, script: 1, plaintext: 1,
};

// Normalize a link label: collapse whitespace runs to one space, trim,
// case-fold. (CommonMark: Unicode case folding; toLowerCase is close enough
// for the cases here, except sharp-s, which folds to "ss".)
function normalizeLabel(s) {
  return s.replace(/\s+/g, ' ').trim().toLowerCase().replace(/ß/g, 'ss');
}

// Parse a link destination starting at s[i] (i points at '<' or a bare char).
// Returns [dest, endIndex] or null. `allowNL` is true inside inline links.
function parseDest(s, i) {
  const n = s.length;
  if (i >= n) return null;
  if (s[i] === '<') {
    let j = i + 1;
    let out = '';
    while (j < n) {
      const c = s[j];
      if (c === '\n' || c === '<') return null;
      if (c === '>') return [out, j + 1];
      if (c === '\\' && j + 1 < n && isPunct(s[j + 1])) { out += s[j + 1]; j += 2; continue; }
      out += c; j++;
    }
    return null;
  }
  let j = i;
  let out = '';
  let depth = 0;
  while (j < n) {
    const c = s[j];
    if (c === ' ' || c === '\n' || c === '\t' || c.charCodeAt(0) < 32) break;
    if (c === '\\' && j + 1 < n && isPunct(s[j + 1])) { out += s[j + 1]; j += 2; continue; }
    if (c === '(') { depth++; out += c; j++; continue; }
    if (c === ')') {
      if (depth === 0) break;
      depth--; out += c; j++; continue;
    }
    out += c; j++;
  }
  // An empty destination "()" is valid (href="").
  if (j === i) {
    if (j < n && s[j] === ')') return ['', j];
    return null;
  }
  return [out, j];
}

// Parse a link title starting at s[i] (after skipping spaces). Returns
// [title, endIndex] or null. A title may span lines; the line endings are
// kept (marked preserves them).
function parseTitle(s, i) {
  const n = s.length;
  if (i >= n) return null;
  const q = s[i];
  if (q !== '"' && q !== "'" && q !== '(') return null;
  const close = q === '(' ? ')' : q;
  let j = i + 1;
  let out = '';
  while (j < n) {
    const c = s[j];
    if (c === close) return [out, j + 1];
    if (c === '\\' && j + 1 < n && isPunct(s[j + 1])) { out += s[j + 1]; j += 2; continue; }
    out += c; j++;
  }
  return null;
}

// Skip spaces/tabs/newlines. Returns index after them.
function skipWS(s, i) {
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\n') i++;
    else break;
  }
  return i;
}

// Try to parse an inline link "(dest title)" starting at s[i] === '('.
// Returns {href, title, end} or null.
function parseInlineLink(s, i, refs) {
  const n = s.length;
  let j = skipWS(s, i + 1);
  if (j >= n) return null;
  const d = parseDest(s, j);
  if (!d) return null;
  let href = d[0];
  j = d[1];
  let title = null;
  const afterDest = skipWS(s, j);
  if (afterDest < n && s[afterDest] !== ')') {
    const t = parseTitle(s, afterDest);
    if (!t) return null;
    title = t[0];
    j = skipWS(s, t[1]);
  } else {
    j = afterDest;
  }
  if (j >= n || s[j] !== ')') return null;
  return { href, title, end: j + 1 };
}

// Scan a bracketed label starting at s[i] === '['. Returns [label, endIndex]
// where endIndex is just past the matching ']', or null.
function scanLabel(s, i) {
  const n = s.length;
  let j = i + 1;
  let depth = 0;
  let out = '';
  while (j < n) {
    const c = s[j];
    // A backslash escape does not end the label, but the backslash stays
    // part of the label text for matching: `[foo\!]` does not match a
    // definition for `[foo!]`.
    if (c === '\\' && j + 1 < n && isPunct(s[j + 1])) { out += c + s[j + 1]; j += 2; continue; }
    // A link label may not contain an unescaped `[` (marked rejects
    // `[ref[bar]]` and `[[[foo]]]` as labels).
    if (c === '[') return null;
    if (c === ']') {
      if (depth === 0) return [out, j + 1];
      depth--; out += c; j++; continue;
    }
    if (c === '\n') { out += c; j++; continue; }
    out += c; j++;
  }
  return null;
}

// Flanking info for a delimiter run ending/starting at position i.
function flanking(s, i, len) {
  const before = i > 0 ? s[i - 1] : '';
  const after = i + len < s.length ? s[i + len] : '';
  const beforeWS = before === '' || isWsU(before);
  const afterWS = after === '' || isWsU(after);
  const beforePunct = before !== '' && isPunctU(before);
  const afterPunct = after !== '' && isPunctU(after);
  const leftFlanking = !afterWS && (!afterPunct || beforeWS || beforePunct);
  const rightFlanking = !beforeWS && (!beforePunct || afterWS || afterPunct);
  return [leftFlanking, rightFlanking];
}

// The main inline parser. `text` is one block's raw text (paragraph,
// heading, table cell, ...). `refs` is the document's link-reference map.
// Returns the rendered HTML fragment (no surrounding <p>).
function inlineParse(text, refs) {
  const s = text;
  const n = s.length;
  // items: strings, or delimiter objects {d, ch, len, open, close, used},
  // or link markers {a, href, title, img} / {aEnd}, or {img, src, title, alt}.
  const items = [];
  const brackets = []; // {idx, textStart, img, hasLink}
  let i = 0;
  let buf = '';
  const flush = () => { if (buf !== '') { items.push(buf); buf = ''; } };

  while (i < n) {
    const c = s[i];
    // --- backslash escapes / hard breaks ---
    if (c === '\\') {
      if (i + 1 < n && s[i + 1] === '\n') {
        flush(); items.push('<br>'); i += 2;
        // A hard break strips the next line's leading whitespace.
        while (i < n && (s[i] === ' ' || s[i] === '\t')) i++;
        continue;
      }
      if (i + 1 < n && isPunct(s[i + 1])) { buf += escText(s[i + 1]); i += 2; continue; }
      buf += '\\'; i++; continue;
    }
    // --- code spans ---
    if (c === '`') {
      let j = i;
      while (j < n && s[j] === '`') j++;
      const run = j - i;
      // find a matching run
      let k = j;
      let found = -1;
      while (k < n) {
        if (s[k] === '`') {
          let m = k;
          while (m < n && s[m] === '`') m++;
          if (m - k === run) { found = k; break; }
          k = m;
        } else k++;
      }
      if (found >= 0) {
        let content = s.slice(j, found);
        content = content.replace(/\n/g, ' ');
        if (content.length >= 2 && content[0] === ' ' && content[content.length - 1] === ' ' && /[^ ]/.test(content)) {
          content = content.slice(1, -1);
        }
        flush();
        items.push('<code>' + escText(content) + '</code>');
        i = found + run;
        continue;
      }
      buf += '`'.repeat(run); i = j; continue;
    }
    // --- emphasis / strikethrough delimiter runs ---
    if (c === '*' || c === '_' || c === '~') {
      let j = i;
      while (j < n && s[j] === c) j++;
      const run = j - i;
      // A run of three or more tildes is not a strikethrough delimiter
      // (`~~~not~~~` stays literal).
      if (c === '~' && run >= 3) { buf += '~'.repeat(run); i = j; continue; }
      // A single `~` is also a strikethrough delimiter (marked renders
      // `~foo~` as <del>foo</del>, same as `~~foo~~`).
      const [lf, rf] = flanking(s, i, run);
      let canOpen, canClose;
      if (c === '*') { canOpen = lf; canClose = rf; }
      else if (c === '_') { canOpen = lf && (!rf || isPunctU(i > 0 ? s[i - 1] : '')); canClose = rf && (!lf || isPunctU(i + run < n ? s[i + run] : '')); }
      else { canOpen = lf; canClose = rf; }
      flush();
      items.push({ d: true, ch: c, len: run, open: canOpen, close: canClose });
      i = j;
      continue;
    }
    // --- entities ---
    if (c === '&') {
      const e = decodeEntity(s, i);
      if (e) { buf += escText(e[0]); i = e[1]; continue; }
      // marked leaves an entity-shaped sequence untouched even when the
      // name is not a real entity (&notanentity; stays literal). Numeric
      // references are not covered here: an invalid one (too many digits,
      // out of range) is escaped, not preserved.
      const m = /^&[A-Za-z][A-Za-z0-9]*;/.exec(s.slice(i, i + 40));
      if (m) { buf += m[0]; i += m[0].length; continue; }
      buf += '&amp;'; i++; continue;
    }
    // --- links / images ---
    if (c === '[' || (c === '!' && i + 1 < n && s[i + 1] === '[')) {
      const img = c === '!';
      flush();
      const start = i;
      const textStart = i + (img ? 2 : 1);
      brackets.push({ idx: items.length, textStart, img, hasLink: false });
      items.push({ br: true });
      i = textStart;
      void start;
      continue;
    }
    if (c === ']') {
      const b = brackets.pop();
      if (!b) { buf += ']'; i++; continue; }
      // try to resolve a link/image
      let resolved = null;
      let end = i + 1;
      let isRef = false;
      let triedFullRef = false;
      if (i + 1 < n && s[i + 1] === '(') {
        const l = parseInlineLink(s, i + 1, refs);
        // A link cannot contain another link, but an image can (its alt
        // text may hold one), so hasLink only bars link brackets.
        if (l && (!b.hasLink || b.img)) { resolved = { href: l.href, title: l.title }; end = l.end; }
      }
      if (!resolved && i + 1 < n && s[i + 1] === '[') {
        const lab = scanLabel(s, i + 1);
        if (lab) {
          const label = lab[0] === '' ? null : normalizeLabel(lab[0]);
          const textRaw = s.slice(b.textStart, i);
          // A collapsed reference uses the bracket text as its label.
          const key = label === null ? normalizeLabel(textRaw) : label;
          const ref = refs.get(key);
          if (ref && (!b.hasLink || b.img)) { resolved = ref; end = lab[1]; isRef = true; }
          // A bracket followed by a label bracket was a full/collapsed
          // reference attempt: if it failed, it does not fall back to a
          // shortcut reference for this bracket.
          triedFullRef = true;
        }
      }
      if (!resolved && !triedFullRef) {
        // shortcut reference
        const textRaw = s.slice(b.textStart, i);
        const ref = refs.get(normalizeLabel(textRaw));
        if (ref && (!b.hasLink || b.img) && textRaw.length > 0) { resolved = ref; isRef = true; }
      }
      void isRef;
      if (resolved) {
        // mark enclosing brackets as containing a link (not for images)
        if (!b.img) for (const ob of brackets) ob.hasLink = true;
        const href = cleanHref(resolved.href);
        if (b.img) {
          const altRaw = s.slice(b.textStart, i);
          const alt = inlineAlt(altRaw, refs);
          buf = ''; // bracket content was only used for the alt text
          items[b.idx] = { img: true, src: href, title: resolved.title, alt };
          // remove the children items (they were only used for alt)
          items.splice(b.idx + 1, items.length - b.idx - 1);
        } else {
          flush();
          items[b.idx] = { a: true, href, title: resolved.title };
          items.push({ aEnd: true });
        }
        i = end;
        continue;
      }
      // no link: literal '[' (or '![')
      items[b.idx] = b.img ? '![' : '[';
      buf += ']'; i++;
      continue;
    }
    // --- autolinks and raw HTML ---
    if (c === '<') {
      const r = parseAutolinkOrTag(s, i, refs);
      if (r) { flush(); items.push(r.html); i = r.end; continue; }
      buf += '&lt;'; i++; continue;
    }
    // --- extended autolinks (www. / scheme:// / email) ---
    if (c === 'w' && s.startsWith('www.', i) && (i === 0 || isWsU(s[i - 1]) || '*_~(<'.indexOf(s[i - 1]) >= 0)) {
      const r = parseExtendedAutolink(s, i, refs);
      if (r) { flush(); items.push(r.html); i = r.end; continue; }
    }
    if ((c === 'h' || c === 'f') && (i === 0 || isWsU(s[i - 1]) || '*_~(<'.indexOf(s[i - 1]) >= 0)) {
      const r = parseExtendedAutolink(s, i, refs);
      if (r) { flush(); items.push(r.html); i = r.end; continue; }
    }
    // --- extended autolinks: bare email (Public@example.com) ---
    // A bare email has no distinctive prefix, so trigger on a word that
    // starts here (letter/digit at a word boundary) and contains '@'
    // before any whitespace.
    if (isLetterOrDigitU(c) && (i === 0 || isWsU(s[i - 1]) || '*_~(<'.indexOf(s[i - 1]) >= 0)) {
      const at = s.indexOf('@', i);
      if (at > i && at - i < 64) {
        let hasWS = false;
        for (let k = i; k < at; k++) { if (isWsU(s[k])) { hasWS = true; break; } }
        if (!hasWS) {
          const r = parseExtendedAutolink(s, i, refs);
          if (r) { flush(); items.push(r.html); i = r.end; continue; }
        }
      }
    }
    // --- hard / soft line breaks ---
    if (c === '\n') {
      // hard break: two or more spaces before the newline
      let k = buf.length;
      let spaces = 0;
      while (k > 0 && buf[k - 1] === ' ') { spaces++; k--; }
      if (spaces >= 2) {
        buf = buf.slice(0, buf.length - spaces);
        flush(); items.push('<br>'); i++;
        // A hard break strips the next line's leading whitespace.
        while (i < n && (s[i] === ' ' || s[i] === '\t')) i++;
        continue;
      }
      buf += '\n'; i++; continue;
    }
    // --- plain text run ---
    if (c === '<') { buf += '&lt;'; i++; continue; }
    if (c === '>') { buf += '&gt;'; i++; continue; }
    if (c === '&') { buf += '&amp;'; i++; continue; }
    if (c === '"') { buf += '&quot;'; i++; continue; }
    if (c === "'") { buf += '&#39;'; i++; continue; }
    buf += c; i++;
  }
  flush();
  resolveEmphasis(items);
  return renderItems(items);
}

// Parse `<...>` at s[i]: an autolink, or raw HTML. Returns {html, end} or null.
function parseAutolinkOrTag(s, i) {
  const n = s.length;
  // HTML comment
  if (s.startsWith('<!--', i)) {
    // Abruptly-closed comments are complete on their own: <!--> and <!--->.
    if (s.startsWith('<!-->', i)) return { html: '<!-->', end: i + 5 };
    if (s.startsWith('<!--->', i)) return { html: '<!--->', end: i + 6 };
    const end = s.indexOf('-->', i + 4);
    if (end >= 0) {
      const body = s.slice(i + 4, end);
      if (!body.endsWith('-')) return { html: s.slice(i, end + 3), end: end + 3 };
    }
    return null;
  }
  // Processing instruction
  if (s.startsWith('<?', i)) {
    const end = s.indexOf('?>', i + 2);
    if (end >= 0) return { html: s.slice(i, end + 2), end: end + 2 };
    return null;
  }
  // Declaration <!A ...>
  if (s.startsWith('<!', i) && i + 2 < n && /[A-Z]/.test(s[i + 2])) {
    const end = s.indexOf('>', i + 2);
    if (end >= 0) return { html: s.slice(i, end + 1), end: end + 1 };
    return null;
  }
  // CDATA
  if (s.startsWith('<![CDATA[', i)) {
    const end = s.indexOf(']]>', i + 9);
    if (end >= 0) return { html: s.slice(i, end + 3), end: end + 3 };
    return null;
  }
  // Autolink: <scheme:...> or <email>
  const gt = s.indexOf('>', i + 1);
  if (gt > i + 1) {
    const inner = s.slice(i + 1, gt);
    if (inner.indexOf('\n') < 0 && inner.indexOf(' ') < 0) {
      const m = /^([A-Za-z][A-Za-z0-9+.-]{1,31}):([^<>]*)$/.exec(inner);
      if (m) {
        const href = cleanHref(inner);
        const text = escTextEnt(inner);
        return { html: `<a href="${escAttr(href)}">${text}</a>`, end: gt + 1 };
      }
      // email autolink
      if (/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/.test(inner)) {
        return { html: `<a href="mailto:${escAttr(inner)}">${escTextEnt(inner)}</a>`, end: gt + 1 };
      }
    }
  }
  // Raw HTML tag: <name ...> or </name ...>
  let j = i + 1;
  let closing = false;
  if (s[j] === '/') { closing = true; j++; }
  if (j >= n || !/[A-Za-z]/.test(s[j])) return null;
  const nameStart = j;
  while (j < n && /[A-Za-z0-9-]/.test(s[j])) j++;
  const name = s.slice(nameStart, j).toLowerCase();
  // The tag name must be followed by whitespace, '>' or '/': `m:abc` is
  // not a tag (the `:` cannot start an attribute with no separator).
  if (j < n && s[j] !== ' ' && s[j] !== '\t' && s[j] !== '\n' && s[j] !== '>' && s[j] !== '/') return null;
  // A closing tag takes no attributes: only whitespace, then '>'.
  if (closing) {
    while (j < n && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n')) j++;
    if (j < n && s[j] === '>') {
      j++;
      return { html: s.slice(i, j), end: j };
    }
    return null;
  }
  // attributes
  while (j < n) {
    while (j < n && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n')) j++;
    if (j >= n) return null;
    if (s[j] === '>') {
      j++;
      // marked passes raw HTML through untouched, disallowed tags included.
      return { html: s.slice(i, j), end: j };
    }
    if (s[j] === '/') {
      if (j + 1 < n && s[j + 1] === '>') {
        j += 2;
        return { html: s.slice(i, j), end: j };
      }
      return null;
    }
    // attribute name
    if (!/[A-Za-z_:]/.test(s[j])) return null;
    while (j < n && /[A-Za-z0-9_.:-]/.test(s[j])) j++;
    while (j < n && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n')) j++;
    if (j < n && s[j] === '=') {
      j++;
      while (j < n && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n')) j++;
      if (j >= n) return null;
      if (s[j] === '"' || s[j] === "'") {
        const q = s[j]; j++;
        while (j < n && s[j] !== q) j++;
        if (j >= n) return null;
        j++;
      } else {
        while (j < n && !/[ \t\n"'=<>`,]/.test(s[j])) j++;
        if (j >= n) return null;
      }
      // After a value, the next character must be whitespace, '>' or '/':
      // attributes run together (`'bar'title`) are not a valid tag.
      if (j < n && s[j] !== ' ' && s[j] !== '\t' && s[j] !== '\n' && s[j] !== '>' && s[j] !== '/') return null;
    }
  }
  return null;
}

// Characters allowed inside an extended autolink (after the scheme/www.).
function extAutolinkChar(ch) {
  if (ch === '') return false;
  const c = ch.charCodeAt(0);
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) ||
    '-._~:/?#[]@!$&\'()*+,;=%'.indexOf(ch) >= 0;
}

// Parse an extended autolink (GFM) at s[i]: www.foo, scheme://foo, or email.
// Returns {html, end} or null.
function parseExtendedAutolink(s, i, refs) {
  const n = s.length;
  void refs;
  // email: scan a local part backwards? We are called at the start of a
  // word; find the word end, then look for '@' inside.
  let j = i;
  while (j < n && extAutolinkChar(s[j])) j++;
  let end = j;
  // trim trailing punctuation per GFM: ? ! . , : ; * _ ~
  const trimEnd = (e) => {
    while (e > i) {
      // A trailing entity reference (&name;) is dropped whole, not just
      // its semicolon.
      const body0 = s.slice(i, e);
      const em = /&[A-Za-z0-9]+;$/.exec(body0);
      if (em) { e -= em[0].length; continue; }
      const ch = s[e - 1];
      if ('?!.,:;*_~'.indexOf(ch) >= 0) { e--; continue; }
      if (ch === ')') {
        // keep if the autolink contains a matching '(' before it
        const body = s.slice(i, e);
        const opens = (body.match(/\(/g) || []).length;
        const closes = (body.match(/\)/g) || []).length;
        if (closes > opens) { e--; continue; }
      }
      break;
    }
    return e;
  };
  const word = s.slice(i, end);
  // scheme:// or www.
  if (word.startsWith('www.')) {
    end = trimEnd(end);
    const body = s.slice(i, end);
    if (!/^www\.[\w-]+(\.[\w-]+)+/.test(body)) return null;
    // must contain a dot in the domain and a valid TLD-ish tail
    if (!/^www\.[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/.test(body) && body.indexOf('.', 4) < 0) return null;
    const href = 'http://' + body;
    return { html: `<a href="${escAttr(cleanHref(href))}">${escTextEnt(body)}</a>`, end };
  }
  const schemeM = /^(https?|ftp):\/\//.exec(word);
  if (schemeM) {
    end = trimEnd(end);
    const body = s.slice(i, end);
    if (body.length <= schemeM[0].length) return null;
    // domain must contain a dot or be localhost-ish; GFM requires a domain
    const rest = body.slice(schemeM[0].length);
    if (rest.indexOf('.') < 0) return null;
    return { html: `<a href="${escAttr(cleanHref(body))}">${escTextEnt(body)}</a>`, end };
  }
  // Any other scheme (mailto:, xmpp:, ...) followed by a non-empty address.
  // The scheme is 2-32 chars; the address runs to the word end (trimmed).
  const anyScheme = /^([A-Za-z][A-Za-z0-9+.-]{1,31}):(.+)$/.exec(word);
  if (anyScheme) {
    // An email-like address ending in `_` or `-` is not an autolink at
    // all (check the raw word: trimEnd would strip the trailing char).
    if (anyScheme[2].indexOf('@') >= 0 && (word.endsWith('_') || word.endsWith('-'))) return null;
    end = trimEnd(end);
    let body = s.slice(i, end);
    let m2 = /^([A-Za-z][A-Za-z0-9+.-]{1,31}):(.+)$/.exec(body);
    if (!m2) return null;
    // The address must contain a dot (a domain) or an '@' (an email-like
    // address); a bare `foo:bar` with neither is not an autolink.
    let addr = m2[2];
    if (addr.indexOf('.') < 0 && addr.indexOf('@') < 0) return null;
    // An email-like address (mailto:) follows email rules: a trailing `_`
    // or `-` invalidates it outright, and a trailing `/` is dropped.
    if (addr.indexOf('@') >= 0) {
      if (addr.endsWith('_') || addr.endsWith('-')) return null;
      if (addr.endsWith('/')) {
        end--;
        body = s.slice(i, end);
        m2 = /^([A-Za-z][A-Za-z0-9+.-]{1,31}):(.+)$/.exec(body);
        if (!m2) return null;
        addr = m2[2];
      }
    }
    // For xmpp-style addresses the resource is a single path segment:
    // `xmpp:foo@bar.baz/txt/bin` links only `xmpp:foo@bar.baz/txt`.
    let linkEnd = end;
    const slash = body.indexOf('/', m2[1].length + 1);
    if (slash > 0) {
      const afterFirst = body.indexOf('/', slash + 1);
      if (afterFirst > 0) linkEnd = i + afterFirst;
    }
    const linkBody = s.slice(i, linkEnd);
    return { html: `<a href="${escAttr(cleanHref(linkBody))}">${escTextEnt(linkBody)}</a>`, end: linkEnd };
  }
  // email
  const at = word.indexOf('@');
  if (at > 0) {
    // A word ending in `_` is not an email address at all (the underscore
    // is part of the domain, which cannot end with it); do not trim it off
    // and link the rest.
    if (word.endsWith('_')) return null;
    end = trimEnd(end);
    const body = s.slice(i, end);
    if (/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(body)) {
      return { html: `<a href="mailto:${escAttr(body)}">${escTextEnt(body)}</a>`, end };
    }
  }
  return null;
}

// Alt text for an image: the bracket text with entities/escapes decoded and
// emphasis stripped (marked renders alt from the parsed inline text, tags
// removed).
function inlineAlt(raw, refs) {
  const html = inlineParse(raw, refs);
  // A nested image contributes its alt text (e.g. `![foo ![bar](/url)](/url2)`
  // has alt `foo bar`, not `foo `).
  const withAlt = html.replace(/<img\b[^>]*?\salt="([^"]*)"[^>]*>/g, '$1');
  const stripped = withAlt.replace(/<[^>]*>/g, '');
  return stripped.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
}

// Resolve emphasis / strong / strikethrough delimiters in `items` in place.
function resolveEmphasis(items) {
  // Each delimiter run gets one slot per delimiter char, emitted
  // left-to-right: null = literal char, a tag string = emit it, '' = spent
  // by a neighbouring slot's multi-delimiter tag. A run used as an opener
  // spends delimiters from its right end, as a closer from its left end,
  // so a partially used run stays a live delimiter and can match again
  // (e.g. `__foo_ bar_` -> the first `_` opens the outer em, the second
  // the inner one).
  const runs = [];
  // Track link depth while collecting runs: an emphasis delimiter inside
  // a link and one outside it must not match (that would cross the link
  // boundary and produce malformed nesting).
  let linkDepth = 0;
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    if (it && typeof it === 'object') {
      if (it.a) linkDepth++;
      else if (it.aEnd) linkDepth--;
      else if (it.d) runs.push({ idx: k, it, ch: it.ch, lo: 0, hi: it.len - 1, slots: new Array(it.len).fill(null), linkDepth });
    }
  }
  const remaining = (r) => r.hi - r.lo + 1;
  // Spans of emphasis already created, as [openerRun, closerRun] indices
  // into `runs`. A delimiter inside a closed span cannot match a closer
  // outside it (e.g. in `*foo _bar* baz_` the `_` inside the `*...*`
  // span stays literal).
  const spans = [];
  // For each closer, walk backwards for an opener. After a match, the
  // same opener is re-checked while it still has delimiters left (a
  // `***` closer can match the same `***` opener twice: strong, then em).
  for (let di = 0; di < runs.length; di++) {
    const closer = runs[di];
    if (!closer.it.close || remaining(closer) <= 0) continue;
    const ch = closer.ch;
    let oi = di - 1;
    while (oi >= 0) {
      const opener = runs[oi];
      if (opener.ch !== ch || !opener.it.open || remaining(opener) <= 0) { oi--; continue; }
      // An opener and closer on opposite sides of a link boundary cannot
      // match (the emphasis would cross the link).
      if (opener.linkDepth !== closer.linkDepth) { oi--; continue; }
      // Skip an opener trapped inside a closed emphasis span.
      let trapped = false;
      for (let si = 0; si < spans.length; si++) {
        if (spans[si][0] < oi && oi < spans[si][1]) { trapped = true; break; }
      }
      if (trapped) { oi--; continue; }
      // rule of three: a both-flanking match is barred when the sum of the
      // two runs' lengths is a multiple of 3, UNLESS both lengths are
      // multiples of 3.
      const bothFlanking =
        (opener.it.open && opener.it.close) || (closer.it.open && closer.it.close);
      const oLen = remaining(opener), cLen = remaining(closer);
      if (bothFlanking && (oLen + cLen) % 3 === 0 && !(oLen % 3 === 0 && cLen % 3 === 0)) { oi--; continue; }
      // use 2 delimiters for strong if both have >= 2, else 1 for em
      const use = remaining(opener) >= 2 && remaining(closer) >= 2 ? 2 : 1;
      const tag = ch === '~' ? 'del' : (use === 2 ? 'strong' : 'em');
      // opener: spend `use` slots from the right; tag on the leftmost.
      const oStart = opener.hi - use + 1;
      opener.slots[oStart] = `<${tag}>`;
      for (let s = oStart + 1; s <= opener.hi; s++) opener.slots[s] = '';
      opener.hi -= use;
      // closer: spend `use` slots from the left; tag on the leftmost.
      closer.slots[closer.lo] = `</${tag}>`;
      for (let s = closer.lo + 1; s < closer.lo + use; s++) closer.slots[s] = '';
      closer.lo += use;
      spans.push([oi, di]);
      if (remaining(closer) <= 0) break;
      // closer still has delimiters left: re-check this opener if it has
      // any left, otherwise move on to the next one
      if (remaining(opener) <= 0) oi--;
    }
  }
  // Render each run: literal chars for unused slots, tags for used ones.
  for (const r of runs) {
    let out = '';
    for (let s = 0; s < r.slots.length; s++) {
      const v = r.slots[s];
      out += v === null ? r.ch : v;
    }
    items[r.idx] = out;
  }
}

// Render the flat items array to an HTML string.
function renderItems(items) {
  let out = '';
  for (const it of items) {
    if (typeof it === 'string') { out += it; continue; }
    if (!it) continue;
    if (it.a) {
      out += `<a href="${escAttr(it.href)}"${it.title !== null && it.title !== undefined ? ` title="${escAttr(it.title)}"` : ''}>`;
      continue;
    }
    if (it.aEnd) { out += '</a>'; continue; }
    if (it.img) {
      out += `<img src="${escAttr(it.src)}" alt="${escAttr(it.alt)}"${it.title !== null && it.title !== undefined ? ` title="${escAttr(it.title)}"` : ''}>`;
      continue;
    }
    // leftover bracket placeholders (should not happen)
    if (it.br) { out += '['; continue; }
  }
  return out;
}

// ---------- block parsing ----------

// A cursor over one line, tab-aware: `i` is the char index, `col` the visual
// column, `pend` the spaces left of a partially consumed tab.
function cur(s) { return { s, i: 0, col: 0, pend: 0 }; }
function curCh(c) { return c.pend > 0 ? ' ' : (c.i < c.s.length ? c.s[c.i] : ''); }
function curAtEnd(c) { return c.pend === 0 && c.i >= c.s.length; }
function curAdvance(c, n) {
  while (n > 0) {
    if (c.pend > 0) {
      const take = c.pend < n ? c.pend : n;
      c.pend -= take; c.col += take; n -= take;
      // A tab whose remaining width is fully consumed is gone: move past
      // it, or the same tab is met again and a scan over it never ends.
      if (c.pend === 0) c.i++;
      continue;
    }
    if (c.i >= c.s.length) return;
    const ch = c.s[c.i];
    if (ch === '\t') {
      const w = 4 - (c.col % 4);
      if (n < w) { c.pend = w - n; c.col += n; n = 0; }
      else { c.i++; c.col += w; n -= w; }
    } else { c.i++; c.col++; n--; }
  }
}
// The remaining text of the line from the cursor (a partially consumed tab
// becomes the spaces that are left of it).
function curRest(c) {
  if (c.pend > 0) return ' '.repeat(c.pend) + c.s.slice(c.i + 1);
  return c.s.slice(c.i);
}
// Skip up to `max` columns of spaces/tabs; returns columns skipped.
// A tab counts at its full width (to the next multiple of 4 columns).
function curSkipSpaces(c, max) {
  let n = 0;
  while (n < max) {
    const ch = curCh(c);
    if (ch !== ' ' && ch !== '\t') break;
    curAdvance(c, 1); n++;
  }
  return n;
}
// Columns of leading spaces/tabs from the cursor's position, counted in
// the line's own columns (a tab runs to the next multiple of 4). Does not
// move the cursor. Use this, not the text after the cursor, when a tab may
// follow a partially consumed one: spelling the rest out as spaces would
// move that tab to the wrong column and change its width.
function leadCols(c) {
  const d = { s: c.s, i: c.i, col: c.col, pend: c.pend };
  let n = 0;
  while (true) {
    const ch = curCh(d);
    if (ch !== ' ' && ch !== '\t') break;
    curAdvance(d, 1); n++;
  }
  return n;
}
// Remove up to `cols` columns of indentation from the start of a raw line
// (used for code block content); a partially consumed tab becomes spaces.
function stripIndentCols(s, cols) {
  const c = cur(s);
  curAdvance(c, cols);
  return curRest(c);
}

// Block-level tags for HTML block type 6.
const BLOCK_TAGS = new Set(('address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu menuitem nav noframes ol optgroup option p param search section summary table tbody td tfoot th thead title tr track ul').split(' '));

// Match the open containers (stack[1..]) against a fresh cursor for `line`.
// Returns {cur, failedAt} where failedAt is the stack index of the first
// container that did not match (-1 when all matched).
function matchContainers(line, stack) {
  const c = cur(line);
  for (let k = 1; k < stack.length; k++) {
    const b = stack[k];
    if (b.t === 'quote') {
      const save = { i: c.i, col: c.col, pend: c.pend };
      curSkipSpaces(c, 3);
      if (curCh(c) === '>') {
        c.i++; c.col++;
        if (curCh(c) === ' ' || curCh(c) === '\t') curAdvance(c, 1);
        continue;
      }
      c.i = save.i; c.col = save.col; c.pend = save.pend;
      return { cur: c, failedAt: k };
    }
    if (b.t === 'item') {
      // blank lines always match an item
      const save = { i: c.i, col: c.col, pend: c.pend };
      // Skip only up to the item's content indent: the rest of the line's
      // leading whitespace is the content's own indent (an indented code
      // block inside the item needs it), so skipping it all would hide it.
      curSkipSpaces(c, b.indent);
      if (curAtEnd(c)) { c.i = save.i; c.col = save.col; c.pend = save.pend; continue; }
      if (c.col >= b.indent) continue;
      c.i = save.i; c.col = save.col; c.pend = save.pend;
      return { cur: c, failedAt: k };
    }
    // 'list' containers consume nothing
  }
  return { cur: c, failedAt: -1 };
}

// Skip spaces/tabs and at most one line end in a definition's virtual
// string; returns the new index, or -1 on a blank line / end.
function skipDefWS(virt, p) {
  while (p < virt.length && (virt[p] === ' ' || virt[p] === '\t')) p++;
  if (p < virt.length && virt[p] === '\n') {
    p++;
    while (p < virt.length && (virt[p] === ' ' || virt[p] === '\t')) p++;
    if (p >= virt.length || virt[p] === '\n') return -1;
  }
  return p;
}

// Parse a link reference definition starting at cursor `c` on lines[li].
// `contentAt` returns the content cursor for any later line (containers
// stripped). Returns {href, title, endLine} or null.
function parseDef(lines, li, c, contentAt) {
  const startLine = li;
  curSkipSpaces(c, 3);
  // label: [ ... ]:
  if (curCh(c) !== '[') return null;
  // Build a virtual string of this line and the following lines first:
  // the label itself may span lines, and so may the title. Keep adding
  // lines until a blank line (a definition cannot span one) or a cap.
  let virt = curRest(c);
  for (let k = 1; k <= 9; k++) {
    if (li + k >= lines.length) break;
    const cc = contentAt(li + k);
    if (!cc) break;
    const rest = curRest(cc);
    if (/^[ \t]*$/.test(rest)) break;
    virt += '\n' + rest;
  }
  const lab = scanLabel(virt, 0);
  if (!lab) return null;
  const rawLabel = lab[0];
  if (rawLabel.length === 0 || rawLabel.length > 999) return null;
  // A label that normalises to empty (only whitespace) is not a definition.
  if (normalizeLabel(rawLabel) === '') return null;
  let p = lab[1]; // index into virt, just past ']'
  if (virt[p] !== ':') return null;
  p++;
  // skip spaces/tabs, and at most one line end, before the destination
  p = skipDefWS(virt, p);
  if (p < 0 || p >= virt.length) return null;
  const d = parseDest(virt, p);
  if (!d) return null;
  const href = d[0];
  const pDest = d[1];
  let title = null;
  p = pDest;
  // skip spaces/tabs, and at most one line end, before an optional title.
  // A title must be separated from the destination by whitespace: a
  // parenthesised title glued to an angle destination is not a title.
  const q = skipDefWS(virt, p);
  if (q > p && q < virt.length && (virt[q] === '"' || virt[q] === "'" || virt[q] === '(')) {
    const t = parseTitle(virt, q);
    if (t) {
      // The title only counts if nothing but whitespace follows it on
      // its line; otherwise the definition has no title and the rest is
      // a separate block (e.g. `[foo]: /url` followed by `"title" ok`).
      let r = t[1];
      while (r < virt.length && (virt[r] === ' ' || virt[r] === '\t')) r++;
      if (r >= virt.length || virt[r] === '\n') {
        title = t[0];
        p = t[1];
      }
    }
  }
  // only spaces/tabs may follow, then end of line
  while (p < virt.length && (virt[p] === ' ' || virt[p] === '\t')) p++;
  if (p >= virt.length || virt[p] !== '\n') {
    // allow end of virtual string only if it is also the end of the last line
    if (p !== virt.length) return null;
  }
  // how many lines did we consume? count newlines before p
  let consumed = 0;
  for (let k = 0; k < p && k < virt.length; k++) if (virt[k] === '\n') consumed++;
  // the definition must end at a line end; if p is mid-line it failed above
  const endLine = startLine + consumed;
  return { label: normalizeLabel(rawLabel), href, title, endLine };
}

// --- block start detectors (operate on a cursor; do not consume it) ---

function isBlankCursor(c) {
  const save = { i: c.i, col: c.col, pend: c.pend };
  curSkipSpaces(c, 1000);
  const blank = curAtEnd(c);
  c.i = save.i; c.col = save.col; c.pend = save.pend;
  return blank;
}

// ATX heading: returns {level, text} or null. `text` is the raw inline text.
function matchATX(c) {
  const save = { i: c.i, col: c.col, pend: c.pend };
  const ind = curSkipSpaces(c, 3);
  if (ind === 3 && curCh(c) !== '#') { c.i = save.i; c.col = save.col; c.pend = save.pend; return null; }
  let level = 0;
  while (curCh(c) === '#') { curAdvance(c, 1); level++; }
  if (level === 0 || level > 6) { c.i = save.i; c.col = save.col; c.pend = save.pend; return null; }
  const after = curCh(c);
  if (after !== '' && after !== ' ' && after !== '\t') { c.i = save.i; c.col = save.col; c.pend = save.pend; return null; }
  let text = curRest(c);
  // strip trailing closing sequence: spaces + #'s + spaces
  text = text.replace(/[ \t]+#+[ \t]*$/, '').replace(/[ \t]+$/, '');
  text = text.replace(/^[ \t]+/, '');
  return { level, text };
}

// Fenced code: returns {char, len, info, indent} or null. `indent` is the
// columns of leading whitespace before the fence, which is how much of a
// content line's indent is removed.
function matchFence(c) {
  const save = { i: c.i, col: c.col, pend: c.pend };
  const startCol = c.col;
  curSkipSpaces(c, 3);
  const indent = c.col - startCol;
  const ch = curCh(c);
  if (ch !== '`' && ch !== '~') { c.i = save.i; c.col = save.col; c.pend = save.pend; return null; }
  let len = 0;
  while (curCh(c) === ch) { curAdvance(c, 1); len++; }
  if (len < 3) { c.i = save.i; c.col = save.col; c.pend = save.pend; return null; }
  const info = curRest(c).replace(/[ \t]+$/, '');
  if (ch === '`' && info.indexOf('`') >= 0) { c.i = save.i; c.col = save.col; c.pend = save.pend; return null; }
  return { char: ch, len, info, indent };
}

// Thematic break.
function matchHR(c) {
  const save = { i: c.i, col: c.col, pend: c.pend };
  curSkipSpaces(c, 3);
  const ch = curCh(c);
  if (ch !== '*' && ch !== '-' && ch !== '_') { c.i = save.i; c.col = save.col; c.pend = save.pend; return null; }
  let count = 0;
  while (!curAtEnd(c)) {
    const x = curCh(c);
    if (x === ch) { count++; curAdvance(c, 1); }
    else if (x === ' ' || x === '\t') curAdvance(c, 1);
    else { c.i = save.i; c.col = save.col; c.pend = save.pend; return null; }
  }
  if (count < 3) { c.i = save.i; c.col = save.col; c.pend = save.pend; return null; }
  return true;
}

// Setext underline: returns 1 for ===, 2 for ---, else 0.
function matchSetext(c) {
  const save = { i: c.i, col: c.col, pend: c.pend };
  curSkipSpaces(c, 3);
  const ch = curCh(c);
  if (ch !== '=' && ch !== '-') { c.i = save.i; c.col = save.col; c.pend = save.pend; return 0; }
  // A setext underline is a run of one char plus optional trailing
  // whitespace only; spaces inside the run (e.g. `= =`, `--- -`) are not
  // an underline.
  let count = 0;
  while (curCh(c) === ch) { count++; curAdvance(c, 1); }
  while (curCh(c) === ' ' || curCh(c) === '\t') curAdvance(c, 1);
  if (!curAtEnd(c) || count < 1) { c.i = save.i; c.col = save.col; c.pend = save.pend; return 0; }
  return ch === '=' ? 1 : 2;
}

// HTML block start: returns type 1-7 or 0.
function matchHTMLBlock(c) {
  const save = { i: c.i, col: c.col, pend: c.pend };
  curSkipSpaces(c, 3);
  if (curCh(c) !== '<') { c.i = save.i; c.col = save.col; c.pend = save.pend; return 0; }
  const rest = curRest(c);
  // The cursor is restored before returning a type: the HTML block's first
  // line keeps its leading spaces (up to three) in the output.
  const done = (t) => { c.i = save.i; c.col = save.col; c.pend = save.pend; return t; };
  if (/^<(script|pre|style|textarea)([\s>]|$)/i.test(rest)) return done(1);
  if (rest.startsWith('<!--')) return done(2);
  if (rest.startsWith('<?')) return done(3);
  if (/^<![A-Z]/.test(rest)) return done(4);
  if (rest.startsWith('<![CDATA[')) return done(5);
  const m = /^<\/?([A-Za-z][A-Za-z0-9-]*)/.exec(rest);
  if (m && BLOCK_TAGS.has(m[1].toLowerCase())) return done(6);
  if (m) {
    // type 7: a complete open or close tag, and nothing else on the line.
    // The tag name alone is not enough: `<http://...>` is an autolink,
    // not a tag, so the part after the name must be valid attributes.
    if (rest[1] === '/') {
      if (/^<\/[A-Za-z][A-Za-z0-9-]*[ \t]*>[ \t]*$/.test(rest)) return done(7);
    } else if (/^<[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \t]*=[ \t]*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*[ \t]*\/?>[ \t]*$/.test(rest)) {
      return done(7);
    }
  }
  c.i = save.i; c.col = save.col; c.pend = save.pend;
  return 0;
}

// Blockquote marker: up to 3 columns of indent, '>', then one optional
// space or tab (a tab counts as that one space; the rest of its width
// stays content). A pure test: the cursor is left where it was.
function matchQuote(c) {
  const save = { i: c.i, col: c.col, pend: c.pend };
  curSkipSpaces(c, 3);
  if (curCh(c) !== '>') { c.i = save.i; c.col = save.col; c.pend = save.pend; return false; }
  curAdvance(c, 1);
  if (curCh(c) === ' ' || curCh(c) === '\t') curAdvance(c, 1);
  c.i = save.i; c.col = save.col; c.pend = save.pend;
  return true;
}

// List item start: returns {bullet, ordered, start, delim, markerLen, contentIndent} or null.
function matchListItem(c) {
  const save = { i: c.i, col: c.col, pend: c.pend };
  const ind = curSkipSpaces(c, 3);
  const ch = curCh(c);
  let bullet = null, ordered = false, start = null, delim = null, markerLen = 0;
  if (ch === '-' || ch === '+' || ch === '*') {
    bullet = ch;
    curAdvance(c, 1);
    markerLen = 1;
  } else if (ch >= '0' && ch <= '9') {
    let num = '';
    while (curCh(c) >= '0' && curCh(c) <= '9' && num.length < 10) { num += curCh(c); curAdvance(c, 1); }
    const d = curCh(c);
    if (num.length === 0 || num.length > 9 || (d !== '.' && d !== ')')) {
      c.i = save.i; c.col = save.col; c.pend = save.pend; return null;
    }
    ordered = true;
    start = parseInt(num, 10);
    delim = d;
    curAdvance(c, 1);
    markerLen = num.length + 1;
  } else {
    c.i = save.i; c.col = save.col; c.pend = save.pend; return null;
  }
  // one space (or tab) must follow, or end of line (empty item)
  const after = curCh(c);
  if (after !== '' && after !== ' ' && after !== '\t') {
    c.i = save.i; c.col = save.col; c.pend = save.pend; return null;
  }
  // The whitespace run after the marker, counted in columns with a tab at
  // its full width. The content indent is the marker plus that run, unless
  // the run is five columns or more, when it is the marker plus one: the
  // rest of the run stays content (so a tab there still counts as code
  // indent). The cursor is left at the content indent, not past the run.
  // All columns here are ABSOLUTE (the cursor may start inside a container,
  // so the skipped leading spaces are not the marker's column).
  const markerCol = save.col + ind;
  const cc = { s: c.s, i: c.i, col: c.col, pend: c.pend };
  let run = 0;
  while (true) {
    const ch = curCh(cc);
    if (ch === ' ') { curAdvance(cc, 1); run++; }
    else if (ch === '\t') { const w = 4 - (cc.col % 4); curAdvance(cc, w); run += w; }
    else break;
  }
  let contentIndent;
  if (curAtEnd(cc)) {
    // empty item: content indent is marker + 1
    contentIndent = markerCol + markerLen + 1;
  } else if (run === 0) {
    contentIndent = markerCol + markerLen + 1;
  } else if (run >= 5) {
    contentIndent = markerCol + markerLen + 1;
  } else {
    contentIndent = markerCol + markerLen + run;
  }
  curAdvance(c, contentIndent - (markerCol + markerLen));
  return { bullet, ordered, start, delim, markerLen, contentIndent, indent: ind };
}

// Table delimiter row: returns aligns array ('left'|'right'|'center'|null)
// or null. `line` is the raw content of the row.
function matchTableDelim(line) {
  const cells = splitTableRow(line);
  if (!cells) return null;
  const aligns = [];
  for (const cell of cells) {
    const t = cell.trim();
    if (!/^:?-+:?$/.test(t)) return null;
    if (t.startsWith(':') && t.endsWith(':')) aligns.push('center');
    else if (t.endsWith(':')) aligns.push('right');
    else if (t.startsWith(':')) aligns.push('left');
    else aligns.push(null);
  }
  return aligns;
}

// Split a table row on unescaped pipes. Returns cell strings or null when
// the row has no pipes at all (a delimiter/header row needs at least one).
function splitTableRow(line) {
  const cells = [];
  let cur = '';
  let hasPipe = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && i + 1 < line.length && line[i + 1] === '|') { cur += '|'; i++; continue; }
    if (ch === '`') {
      // code spans may contain pipes; copy the whole span verbatim, but
      // an escaped pipe inside it is still an escaped pipe (the table
      // parsing resolves `\|` to `|` before inline parsing).
      let j = i;
      while (j < line.length && line[j] === '`') j++;
      const run = j - i;
      let k = j, found = -1;
      while (k < line.length) {
        if (line[k] === '`') {
          let m = k;
          while (m < line.length && line[m] === '`') m++;
          if (m - k === run) { found = k; break; }
          k = m;
        } else k++;
      }
      if (found >= 0) { cur += line.slice(i, found + run).replace(/\\\|/g, '|'); i = found + run - 1; continue; }
      cur += ch; continue;
    }
    if (ch === '|') { cells.push(cur); cur = ''; hasPipe = true; continue; }
    cur += ch;
  }
  cells.push(cur);
  if (!hasPipe) return null;
  // drop empty first/last cells from leading/trailing pipes
  if (cells.length > 0 && cells[0].trim() === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells.pop();
  return cells;
}


// ---------- the block parser's main loop ----------

// Remove up to `maxCols` columns of leading spaces/tabs from `s`
// (a partially consumed tab becomes the spaces left of it).
function stripLeadingSpaces(s, maxCols) {
  const c = cur(s);
  let n = 0;
  while (n < maxCols && (curCh(c) === ' ' || curCh(c) === '\t')) { curAdvance(c, 1); n++; }
  return curRest(c);
}
// Columns of leading spaces/tabs in `s`.
function leadingSpaceCols(s) {
  const c = cur(s);
  let n = 0;
  while (curCh(c) === ' ' || curCh(c) === '\t') { curAdvance(c, 1); n++; }
  return c.col;
}

// Can `content` (a line's text after container markers) start a block that
// interrupts a paragraph? Used for lazy continuation decisions, where the
// line already failed its container: any list marker ends it (the
// "ordered list must start with 1" rule is for interrupting a paragraph
// at the same level, not for a line outside its container).
function canInterruptPara(content) {
  const c = cur(content);
  if (matchQuote(c)) return true;
  if (matchATX(c)) return true;
  if (matchFence(c)) return true;
  const ht = matchHTMLBlock(c);
  // HTML blocks of types 1-6 interrupt a paragraph; type 7 does not.
  if (ht >= 1 && ht <= 6) return true;
  if (matchHR(c)) return true;
  const lit = matchListItem(c);
  if (lit) {
    // Any list item interrupts here, even an empty one (a lone marker is
    // still a list item, not paragraph text).
    return true;
  }
  return false;
}

function htmlCloseRe(type) {
  if (type === 1) return /<\/(script|pre|style|textarea)>/i;
  if (type === 2) return /-->/;
  if (type === 3) return /\?>/;
  if (type === 4) return />/;
  if (type === 5) return /\]\]>/;
  return /$^/; // never
}

function blockParse(lines, refs) {
  const root = { t: 'doc', children: [] };
  const stack = [root];
  let leaf = null; // {t, node, char, len, closeRe, type}
  let li = 0;
  const n = lines.length;
  // A blank line closes the open paragraph: the next non-blank line starts
  // a fresh block instead of continuing it (so indented code, for one,
  // is seen after a blank line).
  let afterBlank = false;

  const contentAt = (idx) => {
    const m = matchContainers(lines[idx], stack);
    return m.failedAt < 0 ? m.cur : null;
  };
  const top = () => stack[stack.length - 1];
  // The open paragraph, if the innermost container's last child is one.
  // None when a blank line has closed it.
  const openPara = () => {
    if (afterBlank) return null;
    const ch = top().children;
    const last = ch[ch.length - 1];
    return last && last.t === 'para' ? last : null;
  };
  const addBlock = (node) => {
    // A block that is not a list item cannot live inside a list: the list
    // is closed first (its item already failed to match this line).
    while (stack.length > 1 && top().t === 'list') stack.pop();
    top().children.push(node);
    afterBlank = false;
    // a new block after a blank line inside an item makes its list loose
    for (let k = stack.length - 1; k >= 1; k--) {
      if (stack[k].t === 'item' && stack[k].blankPending) {
        for (let j = k - 1; j >= 1; j--) {
          if (stack[j].t === 'list') { stack[j].loose = true; break; }
        }
        stack[k].blankPending = false;
        break;
      }
    }
  };
  const markBlank = () => {
    // A blank line contained inside a blockquote does not separate blocks
    // in the enclosing list item, so it must not make the list loose.
    // Otherwise a blank line between two blocks inside a (possibly nested)
    // item makes every enclosing list loose.
    let inQuote = false;
    for (let k = stack.length - 1; k >= 1; k--) {
      if (stack[k].t === 'quote') { inQuote = true; break; }
      if (stack[k].t === 'item') break;
    }
    if (inQuote) return;
    for (let k = stack.length - 1; k >= 1; k--) {
      if (stack[k].t === 'item') stack[k].blankPending = true;
      if (stack[k].t === 'list') stack[k].blankPending = true;
    }
  };

  while (li < n) {
    const line = lines[li];

    // ----- leaf block continuation -----
    if (leaf) {
      const m = matchContainers(line, stack);
      if (m.failedAt >= 0) {
        // A fenced code block's content is literal: a line that fails its
        // enclosing LIST ITEM is still fence content (the fence only ends
        // at a closing fence). But a line that fails a BLOCKQUOTE is
        // outside the quote, so the fence ends with it.
        if (leaf.t === 'fence' && stack[m.failedAt] && stack[m.failedAt].t !== 'quote') {
          const c2 = { s: line, i: 0, col: 0, pend: 0 };
          const strip = Math.min(leadCols(c2), leaf.indent || 0);
          curAdvance(c2, strip);
          leaf.node.lines.push(curRest(c2));
          li++; continue;
        }
        if (leaf.t === 'code') trimCode(leaf.node);
        leaf = null;
        continue; // reprocess this line
      }
      const c = m.cur;
      if (leaf.t === 'fence') {
        const save = { i: c.i, col: c.col, pend: c.pend };
        curSkipSpaces(c, 3);
        let run = 0;
        while (curCh(c) === leaf.char) { curAdvance(c, 1); run++; }
        if (run >= leaf.len && isBlankCursor(c)) {
          // A fenced block drops its trailing blank lines.
          trimCode(leaf.node);
          leaf = null; li++; continue;
        }
        c.i = save.i; c.col = save.col; c.pend = save.pend;
        // Remove the fence's own indent from the content line, counted in
        // the line's own columns (a tab after a container marker keeps
        // its width, so spelling the rest out would misplace it).
        const strip = Math.min(leadCols(c), leaf.indent || 0);
        curAdvance(c, strip);
        leaf.node.lines.push(curRest(c));
        li++; continue;
      }
      if (leaf.t === 'html') {
        if (leaf.type === 6 || leaf.type === 7) {
          // A blank line ends the block: the block is followed by a blank
          // line, so its output carries no trailing newline.
          if (isBlankCursor(c)) { leaf.node.blankAfter = true; leaf = null; continue; }
          leaf.node.lines.push(curRest(c));
          li++; continue;
        }
        const rest = curRest(c);
        leaf.node.lines.push(rest);
        li++;
        if (leaf.closeRe.test(rest)) {
          // The block ends at its closing tag. It is followed by a blank
          // line (no trailing newline) only if the next line is blank.
          if (li < n && /^[ \t]*$/.test(lines[li])) leaf.node.blankAfter = true;
          leaf = null;
        }
        continue;
      }
      if (leaf.t === 'code') {
        // A blank line inside indented code keeps its indent past the
        // four stripped columns (a 6-space blank line contributes two
        // spaces, not an empty line).
        if (isBlankCursor(c)) {
          if (leadCols(c) >= 4) { curAdvance(c, 4); leaf.node.lines.push(curRest(c)); }
          else leaf.node.lines.push('');
          li++; continue;
        }
        // The indent is counted in the line's own columns: a tab after a
        // container marker keeps its width, so the spelled-out rest would
        // misplace it. Strip four columns from the cursor itself.
        if (leadCols(c) >= 4) {
          curAdvance(c, 4);
          leaf.node.lines.push(curRest(c));
          li++; continue;
        }
        trimCode(leaf.node);
        leaf = null;
        continue; // reprocess this line
      }
    }

    // ----- container matching -----
    let m = matchContainers(line, stack);
    if (m.failedAt >= 0) {
      const rest = curRest(m.cur);
      const para = openPara();
      if (para && rest.trim() !== '' && !canInterruptPara(rest)) {
        // A lazy continuation inside a list item drops the indentation
        // up to the item's content indent. A lazy continuation line's
        // leading whitespace is stripped (it joins the paragraph text).
        let text = rest;
        const failed = stack[m.failedAt];
        if (failed && failed.t === 'item') {
          const rc = cur(rest);
          curSkipSpaces(rc, failed.indent);
          text = curRest(rc);
        } else {
          text = rest.replace(/^[ \t]+/, '');
        }
        para.lines.push(text);
        li++; continue;
      }
      while (stack.length > m.failedAt) stack.pop();
      m = matchContainers(line, stack);
    }
    const c = m.cur;

    // ----- blank line -----
    if (isBlankCursor(c)) {
      markBlank();
      afterBlank = true;
      li++;
      continue;
    }

    const para = openPara();

    // ----- paragraph open: setext / table / interrupts / continuation -----
    if (para) {
      const st = matchSetext(c);
      if (st > 0) {
        const parent = top();
        // A heading's text drops the paragraph's outer whitespace.
        const text = para.lines.join('\n').replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
        parent.children[parent.children.indexOf(para)] = { t: 'head', level: st, text };
        li++;
        continue;
      }
      if (para.lines.length === 1) {
        const aligns = matchTableDelim(curRest(c));
        if (aligns) {
          const header = splitTableRow(para.lines[0]) || [para.lines[0]];
          // The delimiter must have exactly as many columns as the header.
          if (aligns.length !== header.length) {
            // Not a table: fall through to the paragraph continuation.
          } else {
          const node = { t: 'table', header, aligns, rows: [] };
          const parent = top();
          parent.children[parent.children.indexOf(para)] = node;
          li++;
          while (li < n) {
            const m2 = matchContainers(lines[li], stack);
            if (m2.failedAt >= 0) break;
            const c2 = m2.cur;
            if (isBlankCursor(c2)) break;
            const rowText = curRest(c2);
            // A blockquote (or other block start) ends the table's rows.
            if (/^\s*>/.test(rowText)) break;
            const cells = splitTableRow(rowText) || [rowText];
            node.rows.push(cells);
            li++;
          }
          continue;
          }
        }
      }
      if (matchHR(c)) {
        addBlock({ t: 'hr' });
        li++;
        continue;
      }
      const atx = matchATX(c);
      if (atx) {
        addBlock({ t: 'head', level: atx.level, text: atx.text });
        li++;
        continue;
      }
      const fen = matchFence(c);
      if (fen) {
        const node = { t: 'fence', info: fen.info, lines: [] };
        addBlock(node);
        leaf = { t: 'fence', node, char: fen.char, len: fen.len, indent: fen.indent };
        li++;
        continue;
      }
      const ht = matchHTMLBlock(c);
      // HTML blocks of types 1-6 interrupt a paragraph; type 7 does not.
      if (ht >= 1 && ht <= 6) {
        const node = { t: 'html', type: ht, lines: [curRest(c)] };
        addBlock(node);
        leaf = { t: 'html', node, type: ht, closeRe: htmlCloseRe(ht) };
        if (htmlCloseRe(ht).test(curRest(c))) {
          leaf = null;
          // The block ends on this line: no trailing newline if the
          // next line is blank.
          if (li + 1 < n && /^[ \t]*$/.test(lines[li + 1])) node.blankAfter = true;
        }
        li++;
        continue;
      }
      const saveList = { i: c.i, col: c.col, pend: c.pend };
      const lit = matchListItem(c);
      if (lit) {
        const after = curRest(c);
        if (after.trim() !== '' && (!lit.ordered || lit.start === 1)) {
          const lf = startListItem(stack, c, lit, addBlock);
          if (lf) leaf = lf;
          li++;
          continue;
        }
      }
      // Not a list item after all: put the marker back, it is paragraph text.
      c.i = saveList.i; c.col = saveList.col; c.pend = saveList.pend;
      if (matchQuote(c)) {
        // A blockquote interrupts the paragraph: open it and reprocess
        // this line inside it.
        const node = { t: 'quote', children: [] };
        addBlock(node);
        stack.push(node);
        continue;
      }
      para.lines.push(curRest(c));
      li++;
      continue;
    }

    // ----- no paragraph: try block starts -----
    const atx = matchATX(c);
    if (atx) {
      addBlock({ t: 'head', level: atx.level, text: atx.text });
      li++;
      continue;
    }
    const fen = matchFence(c);
    if (fen) {
      const node = { t: 'fence', info: fen.info, lines: [] };
      addBlock(node);
      leaf = { t: 'fence', node, char: fen.char, len: fen.len, indent: fen.indent };
      li++;
      continue;
    }
    const ht = matchHTMLBlock(c);
    if (ht > 0) {
      const node = { t: 'html', type: ht, lines: [curRest(c)] };
      addBlock(node);
      if (ht === 6 || ht === 7) {
        leaf = { t: 'html', node, type: ht, closeRe: null };
      } else {
        leaf = { t: 'html', node, type: ht, closeRe: htmlCloseRe(ht) };
        if (htmlCloseRe(ht).test(curRest(c))) {
          leaf = null;
          if (li + 1 < n && /^[ \t]*$/.test(lines[li + 1])) node.blankAfter = true;
        }
      }
      li++;
      continue;
    }
    if (matchHR(c)) {
      addBlock({ t: 'hr' });
      li++;
      continue;
    }
    const lit = matchListItem(c);
    if (lit) {
      const lf = startListItem(stack, c, lit, addBlock);
      if (lf) leaf = lf;
      li++;
      continue;
    }
    if (matchQuote(c)) {
      // Open the blockquote and reprocess this line inside it.
      const node = { t: 'quote', children: [] };
      addBlock(node);
      stack.push(node);
      continue;
    }
    // indented code: 4+ columns of indent
    {
      if (leadCols(c) >= 4 && !isBlankCursor(c)) {
        curAdvance(c, 4);
        const node = { t: 'code', lines: [curRest(c)] };
        addBlock(node);
        leaf = { t: 'code', node };
        li++;
        continue;
      }
    }
    // ----- paragraph start (link reference definitions first) -----
    {
      let cur2 = c;
      let li2 = li;
      while (true) {
        if (isBlankCursor(cur2)) { li2++; break; }
        // Hand parseDef a copy of the cursor: on failure it must not eat
        // the line's leading spaces, which are the paragraph's own text.
        const probe = { s: cur2.s, i: cur2.i, col: cur2.col, pend: cur2.pend };
        const d = parseDef(lines, li2, probe, contentAt);
        if (!d) break;
        if (!refs.has(d.label)) refs.set(d.label, { href: d.href, title: d.title });
        li2 = d.endLine + 1;
        if (li2 >= n) break;
        const m2 = matchContainers(lines[li2], stack);
        if (m2.failedAt >= 0) break;
        cur2 = m2.cur;
      }
      if (li2 >= n) { li = li2; break; }
      if (li2 !== li) { li = li2; continue; }
      const p = { t: 'para', lines: [curRest(c)] };
      addBlock(p);
      li++;
      continue;
    }
  }
  // A code block at the end of the document still drops its trailing
  // blank lines, and so does an unclosed fenced block.
  if (leaf && (leaf.t === 'code' || leaf.t === 'fence')) trimCode(leaf.node);
  return root;
}

function trimCode(node) {
  const L = node.lines;
  while (L.length && L[L.length - 1] === '') L.pop();
}

// Start (or continue) a list item at cursor `c` (after container matching).
function startListItem(stack, c, lit, addBlock) {
  const top = stack[stack.length - 1];
  let list = null;
  if (top.t === 'list') {
    const sameType = lit.ordered
      ? (top.ordered && top.delim === lit.delim)
      : (!top.ordered && top.bullet === lit.bullet);
    if (sameType) list = top;
  }
  if (!list) {
    if (top.t === 'list') stack.pop();
    list = {
      t: 'list', children: [], bullet: lit.bullet, ordered: lit.ordered,
      start: lit.ordered ? lit.start : null, delim: lit.delim,
      loose: false, blankPending: false,
    };
    addBlock(list);
    stack.push(list);
  } else if (list.blankPending) {
    list.loose = true;
    list.blankPending = false;
  }
  const item = { t: 'item', children: [], indent: lit.contentIndent, blankPending: false };
  list.children.push(item);
  stack.push(item);
  if (curAtEnd(c)) return null;
  const content = curRest(c);
  if (content.trim() === '') return null;
  // The item's first content can itself be a block: a fenced code block,
  // an ATX heading, a thematic break, or an indented code block. Return
  // the leaf descriptor when the block stays open (fence / code).
  const fen = matchFence(c);
  if (fen) {
    const node = { t: 'fence', info: fen.info, lines: [] };
    item.children.push(node);
    return { t: 'fence', node, char: fen.char, len: fen.len, indent: fen.indent };
  }
  const atx = matchATX(c);
  if (atx) {
    item.children.push({ t: 'head', level: atx.level, text: atx.text });
    return null;
  }
  if (matchHR(c)) {
    item.children.push({ t: 'hr' });
    return null;
  }
  // An indented code block: four or more columns of indent past the
  // content indent. Count it in the line's own columns.
  if (leadCols(c) >= 4) {
    curAdvance(c, 4);
    const node = { t: 'code', lines: [curRest(c)] };
    item.children.push(node);
    return { t: 'code', node };
  }
  item.children.push({ t: 'para', lines: [content] });
  return null;
}

// ---------- rendering ----------

// The task-list marker at the start of an item's first paragraph, if any.
// Returns {checked, rest} where rest is the remaining raw text.
function taskMarker(text) {
  const m = /^\[([ xX])\]([ \t]+|$)/.exec(text);
  if (!m) return null;
  const after = text.slice(m[0].length);
  return { checked: m[1] !== ' ', rest: after };
}

function renderBlocks(node, refs, loose) {
  switch (node.t) {
    case 'doc': {
      let out = '';
      for (const ch of node.children) out += renderBlocks(ch, refs, false);
      // A document's output ends with a newline; an HTML block followed
      // by a blank line carries none, so add one here if it is missing.
      if (out !== '' && !out.endsWith('\n')) out += '\n';
      return out;
    }
    case 'para': {
      const html = inlineParse(node.lines.join('\n'), refs);
      return loose ? `<p>${html}</p>\n` : `<p>${html}</p>\n`;
    }
    case 'head': {
      return `<h${node.level}>${inlineParse(node.text, refs)}</h${node.level}>\n`;
    }
    case 'code': {
      const text = node.lines.join('\n');
      return `<pre><code>${escText(text + (text === '' ? '' : '\n'))}</code></pre>\n`;
    }
    case 'fence': {
      const info = node.info;
      const first = unescapeBackslash(info).replace(/^[ \t]+/, '').split(/[ \t]/)[0];
      const text = node.lines.join('\n');
      const cls = first !== '' ? ` class="language-${escTextEnt(first)}"` : '';
      return `<pre><code${cls}>${escText(text + (text === '' ? '' : '\n'))}</code></pre>\n`;
    }
    case 'hr': return '<hr>\n';
    case 'html': {
      // An HTML block's output is its raw lines. It carries a trailing
      // newline unless it was followed by a blank line.
      return node.lines.join('\n') + (node.blankAfter ? '' : '\n');
    }
    case 'quote': {
      let out = '<blockquote>\n';
      for (const ch of node.children) out += renderBlocks(ch, refs, false);
      // An HTML block as the last child carries no trailing newline
      // before the closing tag.
      const last = node.children[node.children.length - 1];
      if (last && last.t === 'html' && out.endsWith('\n')) out = out.slice(0, -1);
      return out + '</blockquote>\n';
    }
    case 'list': {
      const tag = node.ordered
        ? (node.start !== 1 ? `<ol start="${node.start}">\n` : '<ol>\n')
        : '<ul>\n';
      let out = tag;
      for (const item of node.children) out += renderBlocks(item, refs, node.loose);
      return out + (node.ordered ? '</ol>\n' : '</ul>\n');
    }
    case 'item': {
      // task list: check the first paragraph's text
      let out = '<li>';
      let kids = node.children;
      let taskHtml = '';
      if (kids.length > 0 && kids[0].t === 'para') {
        const tm = taskMarker(kids[0].lines.join('\n'));
        if (tm) {
          taskHtml = tm.checked
            ? '<input checked="" disabled="" type="checkbox"> '
            : '<input disabled="" type="checkbox"> ';
          const restPara = { t: 'para', lines: [tm.rest] };
          kids = [restPara, ...kids.slice(1)];
        }
      }
      // In a loose list the checkbox sits inside the first paragraph's
      // <p>; in a tight list it precedes the bare text.
      if (!loose) out += taskHtml;
      for (let k = 0; k < kids.length; k++) {
        const ch = kids[k];
        if (ch.t === 'para') {
          const html = inlineParse(ch.lines.join('\n'), refs);
          if (loose) out += `<p>${k === 0 ? taskHtml : ''}${html}</p>\n`;
          else out += html;
        } else {
          out += renderBlocks(ch, refs, false);
        }
      }
      // An HTML block as the last child carries no trailing newline
      // before the closing tag.
      const lastKid = kids[kids.length - 1];
      if (lastKid && lastKid.t === 'html' && out.endsWith('\n')) out = out.slice(0, -1);
      return out + '</li>\n';
    }
    case 'table': {
      const th = (cell, align) => `<th${align ? ` align="${align}"` : ''}>${inlineParse(cell.trim(), refs)}</th>\n`;
      const td = (cell, align) => `<td${align ? ` align="${align}"` : ''}>${inlineParse(cell.trim(), refs)}</td>\n`;
      let out = '<table>\n<thead>\n<tr>\n';
      for (let k = 0; k < node.header.length; k++) {
        out += th(node.header[k], node.aligns[k] !== undefined ? node.aligns[k] : null);
      }
      out += '</tr>\n</thead>\n';
      if (node.rows.length > 0) {
        out += '<tbody>';
        for (const row of node.rows) {
          out += '<tr>\n';
          for (let k = 0; k < node.header.length; k++) {
            const cell = k < row.length ? row[k] : '';
            out += td(cell, node.aligns[k] !== undefined ? node.aligns[k] : null);
          }
          out += '</tr>\n';
        }
        out += '</tbody>';
      }
      return out + '</table>\n';
    }
  }
  return '';
}

// ---------- the entry point ----------

export function parse(markdown) {
  const src = String(markdown).replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  // A source ending in a newline leaves a trailing empty line that is
  // not a real line; dropping it keeps HTML blocks (which swallow blank
  // lines) from gaining a spurious trailing newline.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const refs = new Map();
  const doc = blockParse(lines, refs);
  return renderBlocks(doc, refs, false);
}
