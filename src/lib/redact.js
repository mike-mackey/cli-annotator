// Masks secret values in config lines, keeping the keyword before each value.
export const MASK = '****';

const RULES = [
  [/%\^%#.*?%\^%#/g, MASK],
  [/\$1[a-z]\$\S*/g, MASK],
  [/\b(irreversible-cipher|cipher|simple|plain)(\s+)\S+/g, `$1$2${MASK}`],
  [/\b(password)(\s+)(?!(?:irreversible-cipher|cipher|simple|plain)\b)\S+/g, `$1$2${MASK}`],
  [/\b(authentication-mode\s+(?:md5|hmac-sha1|hmac-sha256))(\s+)(?!(?:cipher|plain|simple|key-id)\b)\S+/g, `$1$2${MASK}`],
  [/\b(snmp-agent\s+community\s+(?:read|write))(\s+)(?!cipher\b)\S+/g, `$1$2${MASK}`],
];

export function redactLine(text) {
  return RULES.reduce((t, [re, to]) => t.replace(re, to), text);
}

export function redactLines(lines) {
  let inKey = false;
  return lines.map(line => {
    const body = line.text.trim();
    let text;
    if (inKey && /^public-key-code\s+end\b/i.test(body)) inKey = false;
    if (inKey) text = line.text.match(/^\s*/)[0] + MASK;
    else text = redactLine(line.text);
    if (/^public-key-code\s+begin\b/i.test(body)) inKey = true;
    return { ...line, text, redacted: text !== line.text };
  });
}
