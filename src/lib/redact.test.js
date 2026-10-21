import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from './parseConfig.js';
import { redactLine, redactLines, MASK } from './redact.js';

test('masks the value and keeps the keyword', () => {
  const cases = [
    [' local-user admin password irreversible-cipher $1c$FAKEfake$', ' local-user admin password irreversible-cipher ****'],
    [' isis authentication-mode md5 cipher %^%#FAKE fake%^%#', ' isis authentication-mode md5 cipher ****'],
    [' ospf authentication-mode hmac-sha256 key-id 1 plain FakePlain1', ' ospf authentication-mode hmac-sha256 key-id 1 plain ****'],
    [' authentication-mode md5 FakeBare1', ' authentication-mode md5 ****'],
    [' password simple FakeSimple1', ' password simple ****'],
    [' password FakeBare2', ' password ****'],
    ['snmp-agent community read FakeCommunity', 'snmp-agent community read ****'],
    ['snmp-agent community write cipher %^%#FAKE%^%#', 'snmp-agent community write cipher ****'],
    [' peer 10.0.0.2 password cipher %^%#FAKE%^%# ', ' peer 10.0.0.2 password cipher **** '],
  ];
  for (const [input, want] of cases) assert.equal(redactLine(input), want, input);
});

test('leaves lines without secrets unchanged', () => {
  for (const t of [' ip address 10.0.0.1 255.255.255.252', ' isis enable 207', 'sysname PE207', ' authentication-mode md5']) {
    assert.equal(redactLine(t), t);
  }
});

test('masks public-key-code bodies and flags redacted lines', () => {
  const text = [
    'rsa peer-public-key peer1',
    ' public-key-code begin',
    '  3082010A 02820101 00FAKE00',
    '  00FAKE01',
    ' public-key-code end',
    ' peer-public-key end',
    '#',
    'aaa',
    ' local-user u1 password irreversible-cipher FAKE',
    '#',
    'return',
  ].join('\n');
  const lines = redactLines(parseConfig(text).lines);
  assert.deepEqual(lines.map(l => l.text), [
    'rsa peer-public-key peer1',
    ' public-key-code begin',
    `  ${MASK}`,
    `  ${MASK}`,
    ' public-key-code end',
    ' peer-public-key end',
    '#',
    'aaa',
    ` local-user u1 password irreversible-cipher ${MASK}`,
    '#',
    'return',
  ]);
  assert.deepEqual(lines.filter(l => l.redacted).map(l => l.n), [3, 4, 9]);
  assert.deepEqual(lines.map(({ n, indent, kind, block, opens }) => ({ n, indent, kind, block, opens })),
    parseConfig(text).lines.map(({ n, indent, kind, block, opens }) => ({ n, indent, kind, block, opens })));
});
