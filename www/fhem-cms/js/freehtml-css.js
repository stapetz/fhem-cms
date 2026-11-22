const PROPERTIES = new Set(`display box-sizing width height min-width max-width min-height max-height
  margin margin-top margin-right margin-bottom margin-left margin-inline margin-block margin-inline-start margin-inline-end
  padding padding-top padding-right padding-bottom padding-left padding-inline padding-block padding-inline-start padding-inline-end
  border border-top border-right border-bottom border-left border-width border-style border-color border-radius
  border-top-left-radius border-top-right-radius border-bottom-left-radius border-bottom-right-radius border-collapse border-spacing
  outline outline-width outline-style outline-color outline-offset background background-color background-image
  background-size background-position background-repeat background-clip background-origin background-blend-mode
  color opacity font font-family font-size font-weight font-style font-variant font-variant-numeric line-height letter-spacing word-spacing
  text-align text-decoration text-decoration-color text-decoration-style text-transform text-overflow text-shadow
  white-space word-break overflow-wrap vertical-align list-style list-style-type list-style-position
  display grid grid-template grid-template-columns grid-template-rows grid-template-areas grid-auto-columns grid-auto-rows
  grid-auto-flow grid-column grid-column-start grid-column-end grid-row grid-row-start grid-row-end grid-area
  gap row-gap column-gap flex flex-direction flex-wrap flex-flow flex-grow flex-shrink flex-basis
  justify-content justify-items justify-self align-content align-items align-self place-content place-items place-self order
  position top right bottom left inset inset-inline inset-block z-index overflow overflow-x overflow-y
  transform transform-origin transform-style perspective perspective-origin backface-visibility offset-path offset-distance offset-rotate
  animation animation-name animation-duration animation-delay animation-timing-function animation-iteration-count
  animation-direction animation-fill-mode animation-play-state transition transition-property transition-duration
  transition-delay transition-timing-function scroll-behavior scroll-snap-type scroll-snap-align scroll-snap-stop
  scroll-margin scroll-padding scrollbar-width scrollbar-color overscroll-behavior overscroll-behavior-x overscroll-behavior-y
  box-shadow filter backdrop-filter -webkit-backdrop-filter cursor pointer-events user-select -webkit-user-select
  object-fit object-position aspect-ratio visibility isolation mix-blend-mode clip-path
  fill fill-rule fill-opacity stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-dasharray
  stroke-dashoffset text-anchor dominant-baseline paint-order vector-effect stop-color stop-opacity
  border-inline border-inline-start border-inline-end border-block border-block-start border-block-end
  border-start-start-radius border-start-end-radius border-end-start-radius border-end-end-radius
  font-stretch font-kerning font-feature-settings font-variation-settings
  content text-indent text-decoration-line text-decoration-thickness text-underline-offset text-wrap text-orientation
  hyphens writing-mode direction unicode-bidi
  columns column-count column-width column-rule column-rule-width column-rule-style column-rule-color
  column-span break-before break-after break-inside
  float clear background-attachment background-position-x background-position-y
  translate rotate scale clip-rule stroke-miterlimit shape-rendering color-interpolation`.split(/\s+/));
const FUNCTIONS = new Set(`url var calc min max clamp rgb rgba hsl hsla hwb lab lch oklab oklch color color-mix
  linear-gradient radial-gradient conic-gradient repeating-linear-gradient repeating-radial-gradient repeating-conic-gradient
  repeat minmax fit-content translate translateX translateY translateZ translate3d scale scaleX scaleY scaleZ scale3d
  rotate rotateX rotateY rotateZ rotate3d skew skewX skewY matrix matrix3d perspective
  cubic-bezier steps linear blur brightness contrast drop-shadow grayscale hue-rotate invert opacity saturate sepia
  inset circle ellipse polygon path
  abs sign mod rem round sin cos tan asin acos atan atan2 pow sqrt hypot`.toLowerCase().split(/\s+/));

export function validateCssStructure(css) {
  return validateCssStructureDetailed(css) === null;
}

export function validateCssStructureDetailed(css) {
  const tokens = [];
  let text = '';
  let textStart = 0;
  let quote = '';
  let quoteStart = -1;
  const brackets = [];
  const trimmedRange = (value, start) => {
    const leading = value.length - value.trimStart().length;
    const trimmed = value.trim();
    return { value: trimmed, start: start + leading, end: start + leading + trimmed.length };
  };
  for (let index = 0; index < css.length; index++) {
    const char = css[index];
    if (quote) {
      text += char;
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
      quoteStart = index;
      text += char;
    } else if (char === '(' || char === '[') {
      brackets.push({ char, start: index });
      text += char;
    } else if (char === ')' || char === ']') {
      if (brackets.pop()?.char !== (char === ')' ? '(' : '[')) {
        return { reason: 'unmatched-bracket', start: index, end: index + 1 };
      }
      text += char;
    } else if (!brackets.length && '{};'.includes(char)) {
      const range = trimmedRange(text, textStart);
      tokens.push({ delimiter: char, ...range, delimiterStart: index });
      text = '';
      textStart = index + 1;
    } else text += char;
  }
  if (quote) return { reason: 'unclosed-quote', start: quoteStart, end: quoteStart + 1 };
  if (brackets.length) {
    const bracket = brackets.at(-1);
    return { reason: 'unclosed-bracket', start: bracket.start, end: bracket.start + 1 };
  }
  const range = trimmedRange(text, textStart);
  if (range.value) tokens.push({ delimiter: ';', ...range, delimiterStart: css.length });
  const stack = [];
  const declaration = (token) => {
    const { value } = token;
    if (!value) return null;
    const match = /^([A-Za-z-][A-Za-z0-9_-]*)\s*:\s*(.+)$/s.exec(value);
    if (!match) return { reason: 'invalid-declaration', start: token.start, end: token.end };
    const name = match[1].toLowerCase();
    const nameStart = token.start + match.index;
    const bodyStart = token.start + match[1].length + match[0].slice(match[1].length).indexOf(match[2]);
    const nameEnd = nameStart + match[1].length;
    const body = match[2].replace(/\s*!important\s*$/i, '').trim();
    if (!PROPERTIES.has(name) && !/^--[A-Za-z0-9_-]{1,64}$/.test(name)) {
      return { reason: 'unknown-property', token: match[1], start: nameStart, end: nameEnd };
    }
    if (name === 'z-index' && !(body === 'auto' || (/^-?[0-9]+$/.test(body) && Number(body) <= 100))) {
      const valueStart = bodyStart + match[2].length - match[2].trimStart().length;
      return { reason: 'invalid-z-index', token: body, start: valueStart, end: valueStart + body.length };
    }
    let plain = '';
    const plainOffsets = [];
    let cursor = 0;
    for (const quoted of match[2].matchAll(/"[^"]*"|'[^']*'/g)) {
      for (let offset = cursor; offset < quoted.index; offset++) {
        plain += match[2][offset];
        plainOffsets.push(bodyStart + offset);
      }
      cursor = quoted.index + quoted[0].length;
    }
    for (let offset = cursor; offset < match[2].length; offset++) {
      plain += match[2][offset];
      plainOffsets.push(bodyStart + offset);
    }
    const invalidChar = /[@{}]/.exec(plain);
    if (invalidChar) {
      const start = plainOffsets[invalidChar.index];
      return { reason: 'invalid-value-token', token: plain[invalidChar.index], start, end: start + 1 };
    }
    for (const call of plain.matchAll(/([A-Za-z-][A-Za-z0-9-]*)\s*\(/g)) {
      if (!FUNCTIONS.has(call[1].toLowerCase())) {
        const start = plainOffsets[call.index];
        return { reason: 'unknown-function', token: call[1], start, end: start + call[1].length };
      }
    }
    return null;
  };
  for (const token of tokens) {
    const { delimiter, value } = token;
    const context = stack.at(-1);
    if (delimiter === '{') {
      if (context?.type === 'declarations') {
        return { reason: 'nested-rule-in-declarations', start: token.start, end: token.end || token.delimiterStart + 1 };
      }
      if (/^@(?:media|supports|container|layer)\b/i.test(value)) stack.push({ type: 'rules', start: token.delimiterStart });
      else if (/^@(?:-webkit-)?keyframes\s+[A-Za-z_][A-Za-z0-9_-]*$/i.test(value)) {
        stack.push({ type: 'keyframes', start: token.delimiterStart });
      }
      else if (value && !value.startsWith('@') && !/:host(?:-context)?\b/i.test(value)
        && (context?.type !== 'keyframes' || /^(?:(?:from|to|[0-9]+(?:\.[0-9]+)?%)\s*,?\s*)+$/i.test(value))) {
        stack.push({ type: 'declarations', start: token.delimiterStart });
      } else {
        return { reason: 'invalid-rule', start: token.start, end: token.end || token.delimiterStart + 1 };
      }
    } else if (delimiter === '}') {
      if (!stack.length) return { reason: 'unmatched-brace', start: token.delimiterStart, end: token.delimiterStart + 1 };
      if (context.type === 'declarations') {
        const problem = declaration(token);
        if (problem) return problem;
      } else if (value !== '') {
        return { reason: 'unexpected-rule-content', start: token.start, end: token.end };
      }
      stack.pop();
    } else if (context?.type === 'declarations') {
      const problem = declaration(token);
      if (problem) return problem;
    } else if (value && !/^@import\s+"cms-validated-resource"(?:\s+[^{};]+)?$/i.test(value)) {
      if (stack.length || tokens.some((entry) => entry.delimiter === '{' || entry.delimiter === '}')) {
        return { reason: 'declaration-outside-rule', start: token.start, end: token.end };
      }
      const problem = declaration(token);
      if (problem) return problem;
    }
  }
  if (stack.length) {
    const open = stack.at(-1);
    return { reason: 'unclosed-rule', start: open.start, end: open.start + 1 };
  }
  return null;
}
