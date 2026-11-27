const NAME = /^[A-Za-z0-9_.-]{1,64}$/;
const READING = /^@?[A-Za-z0-9_.-]{1,64}$/;
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const OPERATORS = new Set(['==', '!=', '<', '<=', '>', '>=', 'contains', 'regex']);
const MAX_VALUE = 1024;
const MAX_PATTERN = 128;
const MAX_RULES = 20;
export const MAX_CONDITION_DEPTH = 8;
export const MAX_CONDITION_NODES = 60;
const INVALID_UNICODE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function parsePattern(pattern) {
  if ([...pattern].length > MAX_PATTERN) throw new Error('Regulärer Ausdruck ist zu lang');
  const chars = [...pattern];
  const start = chars[0] === '^';
  let backslashes = 0;
  for (let i = chars.length - 2; i >= 0 && chars[i] === '\\'; i--) backslashes++;
  const end = chars.at(-1) === '$' && backslashes % 2 === 0;
  const first = start ? 1 : 0;
  const last = chars.length - (end ? 1 : 0);
  const tokens = [];
  for (let i = first; i < last; i++) {
    let char = chars[i], any = false;
    if (char === '\\') {
      if (++i >= last) throw new Error('Unvollständige Regex-Escape-Sequenz');
      char = chars[i];
      if (!'\\.^$*+?'.includes(char)) throw new Error('Nicht unterstützte Regex-Escape-Sequenz');
    } else if (char === '.') {
      any = true;
    } else if ('^$*+?()[]{}|'.includes(char)) {
      throw new Error('Nicht unterstützter regulärer Ausdruck');
    }
    let repeat = '';
    if (i + 1 < last && '*+?'.includes(chars[i + 1])) repeat = chars[++i];
    tokens.push({char, any, repeat});
  }
  return {start, end, tokens};
}

function matchesPattern(value, pattern) {
  const {start, end, tokens} = parsePattern(pattern);
  const chars = [...value];
  let states = new Uint8Array(chars.length + 1);
  if (start) states[0] = 1;
  else states.fill(1);
  for (const token of tokens) {
    const next = new Uint8Array(chars.length + 1);
    if (token.repeat === '*' || token.repeat === '?') next.set(states);
    for (let i = 0; i < chars.length; i++) {
      if (!(token.any || token.char === chars[i])) continue;
      if (states[i] || ((token.repeat === '*' || token.repeat === '+') && next[i])) next[i + 1] = 1;
    }
    states = next;
  }
  return end ? Boolean(states[chars.length]) : states.some(Boolean);
}

export function validateCondition(condition) {
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)
    || !['join,rules', 'expression,join,rules'].includes(Object.keys(condition).sort().join(','))
    || !['and', 'or'].includes(condition.join)
    || !Array.isArray(condition.rules) || condition.rules.length < 1 || condition.rules.length > MAX_RULES) {
    throw new Error('Ungültige Bedingung');
  }
  for (const rule of condition.rules) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)
      || Object.keys(rule).sort().join(',') !== 'device,operator,reading,value'
      || typeof rule.device !== 'string' || !NAME.test(rule.device)
      || typeof rule.reading !== 'string' || !READING.test(rule.reading)
      || !OPERATORS.has(rule.operator) || typeof rule.value !== 'string'
      || [...rule.value].length > MAX_VALUE || /[\u0000-\u001f\u007f]/.test(rule.value)
      || INVALID_UNICODE.test(rule.value)) {
      throw new Error('Ungültige Bedingungsregel');
    }
    if (rule.operator === 'regex') parsePattern(rule.value);
    if (['<', '<=', '>', '>='].includes(rule.operator)
      && (!DECIMAL.test(rule.value) || !Number.isFinite(Number(rule.value)))) {
      throw new Error('Numerischer Vergleich benötigt eine gültige Zahl');
    }
  }
  if (Object.hasOwn(condition, 'expression')) {
    const seen = new Set();
    let nodes = 0;
    const walk = (node, depth) => {
      if (++nodes > MAX_CONDITION_NODES || depth > MAX_CONDITION_DEPTH
        || !node || typeof node !== 'object' || Array.isArray(node)) throw new Error('Ungültiger Bedingungsausdruck');
      const keys = Object.keys(node).sort().join(',');
      if (keys === 'rule') {
        if (!Number.isInteger(node.rule) || node.rule < 0 || node.rule >= condition.rules.length
          || seen.has(node.rule)) throw new Error('Ungültiger Regelverweis');
        seen.add(node.rule);
        return;
      }
      if (!['children,op', 'children,not,op'].includes(keys)
        || !['and', 'or', 'xor'].includes(node.op)
        || (Object.hasOwn(node, 'not') && typeof node.not !== 'boolean')
        || !Array.isArray(node.children) || !node.children.length
        || node.children.length > MAX_RULES) throw new Error('Ungültige Bedingungsgruppe');
      for (const child of node.children) walk(child, depth + 1);
    };
    if (!condition.expression || !Object.hasOwn(condition.expression, 'children')) {
      throw new Error('Bedingungsausdruck benötigt eine Gruppe');
    }
    walk(condition.expression, 1);
    if (seen.size !== condition.rules.length) throw new Error('Nicht verwendete Bedingungsregel');
  }
  return condition;
}

export function conditionDevices(condition) {
  validateCondition(condition);
  return [...new Set(condition.rules.map(rule => rule.device))];
}

export function conditionCost(condition) {
  validateCondition(condition);
  return {rules:condition.rules.length, regex:condition.rules.reduce((sum, rule) =>
    sum + (rule.operator === 'regex' ? [...rule.value].length : 0), 0)};
}

export function validateVisibility(visibility) {
  if (!visibility || typeof visibility !== 'object' || Array.isArray(visibility)
    || Object.keys(visibility).sort().join(',') !== 'condition,mode'
    || !['collapse', 'keep-space'].includes(visibility.mode)) {
    throw new Error('Ungültige Sichtbarkeitsbedingung');
  }
  validateCondition(visibility.condition);
  return visibility;
}

export function evaluateCondition(condition, lookup) {
  validateCondition(condition);
  if (typeof lookup !== 'function') throw new Error('Reading-Suche erforderlich');
  const evaluateRule = rule => {
    const actual = lookup(rule.device, rule.reading);
    let result = null;
    if ((typeof actual === 'string' || typeof actual === 'number')
      && (typeof actual !== 'number' || Number.isFinite(actual))) {
      const value = String(actual);
      if ([...value].length <= MAX_VALUE && !/[\u0000-\u001f\u007f]/.test(value) && !INVALID_UNICODE.test(value)) {
        switch (rule.operator) {
          case '==': result = value === rule.value; break;
          case '!=': result = value !== rule.value; break;
          case 'contains': result = value.includes(rule.value); break;
          case 'regex': result = matchesPattern(value, rule.value); break;
          default: {
            const number = Number(value), expected = Number(rule.value);
            if (DECIMAL.test(value) && Number.isFinite(number)) {
              if (rule.operator === '<') result = number < expected;
              if (rule.operator === '<=') result = number <= expected;
              if (rule.operator === '>') result = number > expected;
              if (rule.operator === '>=') result = number >= expected;
            }
          }
        }
      }
    }
    return result;
  };
  const group = node => {
    if (Object.hasOwn(node, 'rule')) return evaluateRule(condition.rules[node.rule]);
    let unknown = false;
    let parity = false;
    for (const child of node.children) {
      const result = group(child);
      if (result === null) unknown = true;
      else if (node.op === 'and' && !result) return node.not ? true : false;
      else if (node.op === 'or' && result) return node.not ? false : true;
      else if (node.op === 'xor' && result) parity = !parity;
    }
    if (unknown) return null;
    const result = node.op === 'and' ? true : node.op === 'or' ? false : parity;
    return node.not ? !result : result;
  };
  return group(condition.expression || {op:condition.join, children:condition.rules.map((_, rule) => ({rule}))});
}
