import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {readFileSync} from 'node:fs';
import { conditionDevices, evaluateCondition, validateCondition } from '../www/fhem-cms/js/condition.js';
import { decodeCondition, encodeCondition, markupConditionDevices } from '../www/fhem-cms/js/condition-markup.js';
import { blueprintDevices, remapBlueprintDevice } from '../www/fhem-cms/js/fcui-schema5-blueprints.js';
import { schema5GridItems } from '../www/fhem-cms/js/fcui-schema5-layout.js';

const rule = (operator, value, device = 'Sensor') => ({device, reading:'state', operator, value});
const condition = (join, ...rules) => ({join, rules});
const evaluate = (operator, expected, actual) =>
  evaluateCondition(condition('and', rule(operator, expected)), () => actual);

test('documented manual HTML conditions use valid identical if/unless encodings', () => {
  const documentation = readFileSync(new URL('../docs/ANWENDER.md',import.meta.url),'utf8');
  const codes = [...documentation.matchAll(/data-cms-(?:if|unless)="([0-9a-f]+)"/g)].map(match=>match[1]);
  assert.equal(codes.length,2);
  assert.equal(codes[0],codes[1]);
  const rule = decodeCondition(codes[0]);
  assert.deepEqual(rule,{join:'and',rules:[{device:'Lampe',reading:'state',operator:'==',value:'on'}]});
  assert.equal(evaluateCondition(rule,()=> 'on'),true);
  assert.equal(evaluateCondition(rule,()=> 'off'),false);
  assert.equal(evaluateCondition(rule,()=> null),null);
});

test('condition comparisons use exact text and strict finite numbers', () => {
  assert.equal(evaluate('==', '01', '1'), false);
  assert.equal(evaluate('!=', '01', '1'), true);
  assert.equal(evaluate('contains', 'ell', 'hello'), true);
  assert.equal(evaluate('<', '2', '1.5'), true);
  assert.equal(evaluate('<=', '2', '2'), true);
  assert.equal(evaluate('>', '2', '3'), true);
  assert.equal(evaluate('>=', '2', '2'), true);
  for (const value of [null, undefined, {}, '1x', 'Infinity', '']) {
    assert.equal(evaluate('>', '2', value), null);
  }
  assert.equal(evaluate('==', '', ''), true);
  assert.throws(() => validateCondition(condition('and', rule('>', '2x'))));
});

test('three-valued AND and OR preserve decisive results', () => {
  const lookup = device => device === 'Missing' ? null : 'on';
  assert.equal(evaluateCondition(condition('and', rule('==', 'off'), rule('==', 'on', 'Missing')), lookup), false);
  assert.equal(evaluateCondition(condition('and', rule('==', 'on'), rule('==', 'on', 'Missing')), lookup), null);
  assert.equal(evaluateCondition(condition('or', rule('==', 'on'), rule('==', 'on', 'Missing')), lookup), true);
  assert.equal(evaluateCondition(condition('or', rule('==', 'off'), rule('==', 'on', 'Missing')), lookup), null);
  assert.deepEqual(conditionDevices(condition('and', rule('==', 'on'), rule('==', 'on', 'Missing'))),
    ['Sensor', 'Missing']);
});

test('nested groups, XOR and negation use explicit three-valued logic', () => {
  const rules = ['A', 'B', 'C'].map(device => rule('==', 'on', device));
  const refs = [0, 1, 2].map(rule => ({rule}));
  const build = expression => ({join:'and', rules, expression});
  const lookup = values => device => values[device];
  const grouped = build({op:'or', children:[{op:'and', children:refs.slice(0, 2)}, refs[2]]});
  assert.equal(evaluateCondition(grouped, lookup({A:'on', B:'on', C:'off'})), true);
  assert.equal(evaluateCondition(grouped, lookup({A:'on', B:'off', C:'off'})), false);
  assert.equal(evaluateCondition(grouped, lookup({A:'on', B:null, C:'off'})), null);
  assert.equal(evaluateCondition(grouped, lookup({A:'off', B:null, C:'off'})), false);
  assert.equal(evaluateCondition(grouped, lookup({A:'on', B:null, C:'on'})), true);
  const xor = build({op:'xor', children:refs});
  for (let bits = 0; bits < 8; bits++) {
    const values = Object.fromEntries(['A', 'B', 'C'].map((name, i) => [name, bits & (1 << i) ? 'on' : 'off']));
    assert.equal(evaluateCondition(xor, lookup(values)), [1, 2, 4, 7].includes(bits));
  }
  assert.equal(evaluateCondition(xor, lookup({A:'on', B:null, C:'on'})), null);
  for (const op of ['and', 'or', 'xor']) {
    for (const a of ['on', 'off', null]) for (const b of ['on', 'off', null]) {
      const base = {op, children:[refs[0], refs[1], refs[2]]};
      const values = {A:a, B:b, C:'off'};
      const plain = evaluateCondition(build(base), lookup(values));
      const negated = evaluateCondition(build({...base, not:true}), lookup(values));
      assert.equal(negated, plain === null ? null : !plain);
    }
  }
});

test('expression validation and Perl agree on references, types and bounds', () => {
  const rules = Array.from({length:20}, (_, i) => rule('==', 'on', `S${i}`));
  const build = (expression, count = 2) => ({join:'and', rules:rules.slice(0, count), expression});
  const leaves = [{rule:0}, {rule:1}];
  const group = children => ({op:'and', children});
  let maxDepth = {rule:0};
  for (let i = 0; i < 7; i++) maxDepth = group([maxDepth]);
  const sixty = group(rules.map((_, i) => i === 19 ? group([{rule:i}]) : group([group([{rule:i}])])));
  const cases = [
    [build(group(leaves)), true], [build({op:'xor', not:true, children:leaves}), true],
    [build(maxDepth, 1), true], [build(group([maxDepth]), 1), false],
    [build(sixty, 20), true],
    [build(group(rules.map((_, i) => group([group([{rule:i}])]))), 20), false],
    [build({rule:0}, 1), false], [build(group([{rule:0}, {rule:0}])), false],
    [build(group([{rule:0}])), false], [build(group([{rule:0}, {rule:2}])), false],
    [build(group([{rule:'0'}, {rule:1}])), false], [build(group([{rule:0.5}, {rule:1}])), false],
    [build(group([]), 1), false], [build({op:'nand', children:leaves}), false],
    [build({op:'and', not:1, children:leaves}), false],
    [build({op:'and', not:null, children:leaves}), false],
    [build({op:'and', children:leaves, extra:true}), false],
    [build(group([{rule:0, extra:true}, {rule:1}])), false],
  ];
  const perl = spawnSync('perl', ['-MJSON::PP', '-e',
    `require './FHEM/01_FHEMCMS.pm'; local $/; my $cases=decode_json(<STDIN>);
      print encode_json([map { defined(FHEMCMS_ValidateCondition($_)) ? 0 : 1 } @{$cases}]);`],
  {input:JSON.stringify(cases.map(([value]) => value)), encoding:'utf8'});
  assert.equal(perl.status, 0, perl.stderr);
  const results = JSON.parse(perl.stdout);
  cases.forEach(([value, expected], index) => {
    let valid = true;
    try { validateCondition(value); } catch { valid = false; }
    assert.equal(valid, expected, JSON.stringify(value));
    assert.equal(Boolean(results[index]), expected, `Perl: ${JSON.stringify(value)}`);
  });
});

test('bounded regex subset handles anchors, repetitions and escaping without backtracking', () => {
  for (const [pattern, text, expected] of [
    ['^a+b?c*$', 'aaabcc', true], ['^a+b?c*$', 'xaaabcc', false],
    ['a.b', 'xaXby', true], ['a\\.b', 'a.b', true], ['a\\.b', 'acb', false],
    ['a*', '', true], ['$','abc',true], ['^$', '', true], ['^$', 'a', false],
    ['\\\\$', '\\', true],
  ]) assert.equal(evaluate('regex', pattern, text), expected, `${pattern} / ${text}`);
  for (const pattern of ['(a+)+$', '[ab]', 'a|b', 'a{2}', '\\d', 'a**', 'a\\']) {
    assert.throws(() => validateCondition(condition('and', rule('regex', pattern))), pattern);
  }
  assert.equal(evaluate('regex', 'a*a*a*a*a*a*a*a*b', 'a'.repeat(1000)), false);
});

test('bounded regex matches standard semantics for the supported grammar', () => {
  const atoms = ['a', 'b', '.', '\\.', '\\*'];
  const tokens = atoms.flatMap(atom => ['', '*', '+', '?'].map(repeat => atom + repeat));
  const texts = ['', 'a', 'b', '.', '*', 'aa', 'ab', 'b.a', 'a*b'];
  for (const first of tokens) for (const second of tokens) {
    for (const prefix of ['', '^']) for (const suffix of ['', '$']) {
      const pattern = prefix + first + second + suffix;
      const expected = new RegExp(pattern);
      for (const text of texts) {
        assert.equal(evaluate('regex', pattern, text), expected.test(text), `${pattern} / ${text}`);
      }
    }
  }
});

test('condition contracts reject unknown fields, oversized values and excessive rules', () => {
  assert.throws(() => validateCondition({join:'and', rules:[], extra:true}));
  assert.throws(() => validateCondition(condition('and', ...Array.from({length:21}, () => rule('==', '1')))));
  assert.throws(() => validateCondition(condition('or', rule('regex', 'a'.repeat(129)))));
  assert.equal(evaluate('==', 'x', 'x'.repeat(1025)), null);
  assert.equal(evaluate('==', 'x', '\ud800'), null);
  assert.throws(() => validateCondition(condition('and', rule('==', '\ud800'))));
  assert.throws(() => validateCondition(condition('and', rule('==', '\udc00'))));
  assert.equal(evaluate('==', '💡', '💡'), true);
  assert.throws(() => validateCondition(condition('or', {...rule('==', 'x'), extra:true})));
});

test('Perl and JavaScript agree on regex grammar and numeric boundaries', () => {
  const alphabet = ['a', '.', '^', '$', '\\', '*', '+', '?', '(', ')', '[', ']', '|', '€', '\n'];
  const patterns = ['', ...alphabet];
  for (const a of alphabet) for (const b of alphabet) patterns.push(a + b);
  for (const a of alphabet) for (const b of ['a', '\\', '$', '*']) {
    for (const c of alphabet) patterns.push(a + b + c);
  }
  const cases = patterns.map(pattern => condition('and', rule('regex', pattern)));
  cases.push(...['-1', '1e9999', '.5', '12.', '１２', '1e-1000', '1_0', '+1e2', '']
    .map(value => condition('and', rule('>', value))));
  const perl = spawnSync('perl', ['-MJSON::PP', '-e',
    `require './FHEM/01_FHEMCMS.pm'; local $/; my $cases=decode_json(<STDIN>);
      print encode_json([map { defined(FHEMCMS_ValidateCondition($_)) ? 0 : 1 } @{$cases}]);`],
  {input:JSON.stringify(cases), encoding:'utf8'});
  assert.equal(perl.status, 0, perl.stderr);
  const actual = JSON.parse(perl.stdout);
  cases.forEach((value, index) => {
    let valid = true;
    try { validateCondition(value); } catch { valid = false; }
    assert.equal(Boolean(actual[index]), valid, JSON.stringify(value));
  });
});

test('condition markup preserves Unicode and is remapped in blueprints', () => {
  const original = {...condition('and', rule('==', 'Öffnen & "Tür"'), rule('==', 'on', 'Other')),
    expression:{op:'xor', not:true, children:[{rule:0}, {op:'or', children:[{rule:1}]}]}};
  const encoded = encodeCondition(original);
  assert.deepEqual(decodeCondition(encoded), original);
  assert.throws(() => decodeCondition('ff'));
  assert.throws(() => decodeCondition('7b7d'));
  const widget = {type:'text', html:`<span data-cms-if="${encoded}">Text</span>`,
    visibility:{condition:original,mode:'collapse'}};
  assert.deepEqual(markupConditionDevices(widget.html), ['Sensor', 'Other']);
  assert.deepEqual(blueprintDevices(widget), ['Sensor', 'Other']);
  const mapped = remapBlueprintDevice(widget, 'Sensor', 'NewSensor');
  assert.deepEqual(blueprintDevices(mapped), ['NewSensor', 'Other']);
  assert.equal(mapped.visibility.condition.rules[0].device, 'NewSensor');
  assert.equal(decodeCondition(mapped.html.match(/data-cms-if="([^"]+)"/)[1]).rules[0].device, 'NewSensor');
  assert.deepEqual(mapped.visibility.condition.expression, original.expression);
});

test('page budget counts every inline and widget condition', () => {
  const many = condition('and', ...Array.from({length:20}, () => rule('==', 'on')));
  const encoded = encodeCondition(many);
  const widget = {id:'text', type:'text', html:`<span data-cms-if="${encoded}">x</span>`.repeat(10),
    grid:{col:1,row:2,w:6,h:2}};
  const config = {schemaVersion:5, settings:{layoutMode:'grid',gridColumns:12},
    navigation:{grid:{col:1,row:1,w:12,h:1}},pages:[{id:'one',widgets:[widget]}]};
  assert.doesNotThrow(() => schema5GridItems(config, 'one'));
  widget.visibility = {condition:condition('and', rule('==', 'on')),mode:'collapse'};
  assert.throws(() => schema5GridItems(config, 'one'), /Zu viele Bedingungsregeln/);
});
