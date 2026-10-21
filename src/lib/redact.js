// Masks secret values in config lines, keeping the keyword before each value.
// Fails closed: an unterminated %^%# blob is masked to the end of the line and
// through every following line until the closing %^%#.
export const MASK = '****';

const MOD = '(?:irreversible-cipher|cipher|simple|plain)';
const DELIM = '%^%#';

const RULES = [
  // Paired %^%# … %^%# blobs, then an unterminated one to the end of the line.
  [/%\^%#.*?%\^%#/g, MASK],
  [/%\^%#.*$/, MASK],
  [/\$1[a-z]\$\S*/gi, MASK],
  // mpls ldp md5-password cipher|plain <peer> <value>
  [/\b(md5-password\s+(?:cipher|plain)\s+\S+)(\s+)\S+/gi, `$1$2${MASK}`],
  // <modifier> <value>; a modifier word is never itself the value.
  [new RegExp(`(?<!md5-password\\s+)\\b(${MOD})(\\s+)(?!${MOD}\\b)(?!\\*{4})\\S+`, 'gi'), `$1$2${MASK}`],
  [new RegExp(`\\b(password|shared-key|pre-shared-key|key-string|securityname)(\\s+)(?!${MOD}\\b)(?!\\*{4})\\S+`, 'gi'), `$1$2${MASK}`],
  // authentication-mode <alg> [key-id] [<n>] <value>; the optional parts are
  // taken greedily (lookahead + backreference) so the key id is never the value.
  [new RegExp(`\\b((?:authentication|privacy)-mode\\s+(?!(?:keychain|local|radius|hwtacacs|none|aaa)\\b)(?!${MOD}\\b)[\\w-]+(?=((?:\\s+key-id)?(?:\\s+\\d+)?))\\2)(\\s+)(?!${MOD}\\b)(?!\\*{4})\\S+`, 'gi'), `$1$3${MASK}`],
  [new RegExp(`\\b(snmp-agent\\s+community\\s+(?:read|write|complex))(\\s+)(?!${MOD}\\b)(?!\\*{4})\\S+`, 'gi'), `$1$2${MASK}`],
];

export function redactLine(text) {
  return RULES.reduce((t, [re, to]) => t.replace(re, to), text);
}

const delimCount = (t) => t.split(DELIM).length - 1;

export function redactLines(lines) {
  let inKey = false;
  let inBlob = false;
  return lines.map(line => {
    const body = line.text.trim();
    const indent = line.text.match(/^\s*/)[0];
    let text;
    if (inBlob) {
      const end = line.text.indexOf(DELIM);
      if (end === -1) text = indent + MASK;
      else if (/\S/.test(line.text[end + DELIM.length] ?? ' ')) {
        // A delimiter glued to following text is a new opener (an earlier blob
        // was truncated), not the closer: mask this line as a fresh blob.
        text = redactLine(line.text);
        inBlob = delimCount(line.text) % 2 === 1;
      } else {
        const rest = line.text.slice(end + DELIM.length);
        text = indent + MASK + redactLine(rest);
        inBlob = delimCount(rest) % 2 === 1;
      }
    } else {
      if (inKey && /^public-key-code\s+end\b/i.test(body)) inKey = false;
      if (inKey) text = indent + MASK;
      else text = redactLine(line.text);
      if (/^public-key-code\s+begin\b/i.test(body)) inKey = true;
      if (delimCount(line.text) % 2 === 1) inBlob = true;
    }
    return { ...line, text, redacted: text !== line.text };
  });
}
