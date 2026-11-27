import { conditionCost, conditionDevices, evaluateCondition, validateCondition } from './condition.js';

const TAG = /<(?:span|div)((?:\s+[a-z][a-z0-9-]*\s*=\s*"[^"]*")*)\s*\/?>/gi;
const ATTRIBUTE = /\sdata-cms-(?:if|unless)\s*=\s*"([0-9a-f]+)"/gi;
const MAX_ENCODING = 50000;

export function encodeCondition(condition) {
  validateCondition(condition);
  const encoded = [...new TextEncoder().encode(JSON.stringify(condition))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (encoded.length > MAX_ENCODING) throw new Error('Bedingungsmarkierung ist zu lang');
  return encoded;
}

export function markupConditionCost(html) {
  const total = {rules:0, regex:0};
  for (const condition of markupConditions(html)) {
    const cost = conditionCost(condition);
    total.rules += cost.rules;
    total.regex += cost.regex;
  }
  return total;
}

export function decodeCondition(value) {
  if (typeof value !== 'string' || value.length > MAX_ENCODING || !/^(?:[0-9a-f]{2})+$/.test(value)) {
    throw new Error('Ungültige Bedingungsmarkierung');
  }
  const bytes = Uint8Array.from(value.match(/../g), byte => parseInt(byte, 16));
  let condition;
  try {
    condition = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
  } catch {
    throw new Error('Ungültige Bedingungsmarkierung');
  }
  return validateCondition(condition);
}

function* markupConditions(html) {
  for (const tag of String(html).replace(/<!--(?:(?!-->).)*-->/gs, '').matchAll(TAG)) {
    for (const match of tag[1].matchAll(ATTRIBUTE)) yield decodeCondition(match[1]);
  }
}

export function markupConditionDevices(html) {
  const devices = new Set();
  for (const condition of markupConditions(html)) {
    for (const device of conditionDevices(condition)) devices.add(device);
  }
  return [...devices];
}

export function applyMarkupConditions(root, lookup) {
  for (const element of root.querySelectorAll('[data-cms-if], [data-cms-unless]')) {
    const inverse = element.hasAttribute('data-cms-unless');
    const value = element.getAttribute(inverse ? 'data-cms-unless' : 'data-cms-if');
    const result = evaluateCondition(decodeCondition(value), lookup);
    if (result === null || result === inverse) element.remove();
    else {
      element.removeAttribute('data-cms-if');
      element.removeAttribute('data-cms-unless');
    }
  }
}
