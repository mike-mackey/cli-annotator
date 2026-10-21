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

const noFake = (t) => !/FAKE/i.test(t);

test('a modifier word is never taken as the value (C1)', () => {
  for (const t of [
    ' isis authentication-mode simple plain FAKE1',
    ' area-authentication-mode simple plain FAKE2',
    ' peer 1.1.1.1 password simple plain FAKE7',
  ]) {
    const out = redactLine(t);
    assert.ok(noFake(out), out);
    assert.ok(out.includes('plain ****'), out);
  }
});

test('unterminated %^%# blobs fail closed (I1)', () => {
  assert.equal(redactLine(' cipher %^%#abc def'), ` cipher ${MASK}`);
  assert.equal(redactLine('  %^%#abcdef'), `  ${MASK}`);
  const text = [
    'aaa',
    ' local-user u1 password cipher %^%#AAAA',
    'BBBB',
    'BBB%^%#',
    ' local-user u1 level 3',
    '#',
  ].join('\n');
  const lines = redactLines(parseConfig(text).lines);
  assert.deepEqual(lines.map(l => l.text), [
    'aaa',
    ` local-user u1 password cipher ${MASK}`,
    MASK,
    MASK,
    ' local-user u1 level 3',
    '#',
  ]);
  assert.deepEqual(lines.filter(l => l.redacted).map(l => l.n), [2, 3, 4]);
});

test('a wrapped blob keeps the indent of continuation lines', () => {
  const text = 'a\n cipher %^%#X\n   YYYY\n   ZZ%^%# tail';
  const out = redactLines(parseConfig(text).lines).map(l => l.text);
  assert.deepEqual(out, ['a', ` cipher ${MASK}`, `   ${MASK}`, `   ${MASK} tail`]);
});

test('masks the remaining bare-secret forms (I2)', () => {
  const cases = [
    [' authentication-mode sha FAKE1', ' authentication-mode sha ****'],
    [' authentication-mode md5 key-id 1 FAKE2', ' authentication-mode md5 key-id 1 ****'],
    [' ospf authentication-mode md5 1 FAKE3', ' ospf authentication-mode md5 1 ****'],
    [' mpls ldp md5-password cipher 1.1.1.1 FAKE4', ' mpls ldp md5-password cipher 1.1.1.1 ****'],
    [' mpls ldp md5-password plain 1.1.1.1 FAKE4b', ' mpls ldp md5-password plain 1.1.1.1 ****'],
    [' pre-shared-key FAKE5', ' pre-shared-key ****'],
    [' shared-key FAKE6', ' shared-key ****'],
    [' key-string FAKE7', ' key-string ****'],
    ['snmp-agent community complex FAKE8', 'snmp-agent community complex ****'],
    ['snmp-agent community read FAKE9', 'snmp-agent community read ****'],
    ['snmp-agent community write FAKE10', 'snmp-agent community write ****'],
    [' snmp-agent target-host x securityname FAKE11 v2c', ' snmp-agent target-host x securityname **** v2c'],
    [' PASSWORD FAKE12', ' PASSWORD ****'],
    [' Cipher FAKE13', ' Cipher ****'],
    [' password $1C$FAKE14$', ` password ${MASK}`],
  ];
  for (const [input, want] of cases) assert.equal(redactLine(input), want, input);
});

test('leaves non-secret authentication and address lines unchanged (I2)', () => {
  for (const t of [
    ' ip address 1.1.1.1 255.255.255.0',
    ' authentication-mode keychain KC1',
    ' authentication-mode md5',
    ' isis authentication-mode md5 key-id 1',
  ]) assert.equal(redactLine(t), t);
});

test('two consecutive truncated blobs: the second opener is not read as a closer', () => {
  const out = redactLines([
    { n: 1, text: 'local-user a password irreversible-cipher %^%#AAAAFAKE1', indent: 0 },
    { n: 2, text: ' local-user b password irreversible-cipher %^%#FAKE2SECRET', indent: 1 },
    { n: 3, text: ' FAKE3CONT%^%# tail', indent: 1 },
    { n: 4, text: 'interface GigabitEthernet0/1/1', indent: 0 },
  ]).map(l => l.text).join('\n');
  assert.ok(!out.includes('FAKE'));
  assert.ok(out.includes('interface GigabitEthernet0/1/1'));
});

test('AAA method words are not masked as authentication-mode values; privacy-mode values are', () => {
  assert.equal(redactLine(' authentication-mode hwtacacs local'), ' authentication-mode hwtacacs local');
  assert.equal(redactLine(' authentication-mode radius local'), ' authentication-mode radius local');
  const out = redactLine('snmp-agent usm-user v3 u authentication-mode sha FAKE privacy-mode aes128 FAKE2');
  assert.ok(!out.includes('FAKE'));
});
