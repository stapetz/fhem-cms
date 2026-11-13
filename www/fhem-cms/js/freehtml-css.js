const PROPERTIES = new Set(`display box-sizing width height min-width max-width min-height max-height
  margin margin-top margin-right margin-bottom margin-left margin-inline margin-block margin-inline-start margin-inline-end
  padding padding-top padding-right padding-bottom padding-left padding-inline padding-block padding-inline-start padding-inline-end
  border border-top border-right border-bottom border-left border-width border-style border-color border-radius
  border-top-left-radius border-top-right-radius border-bottom-left-radius border-bottom-right-radius border-collapse border-spacing
  outline outline-width outline-style outline-color outline-offset background background-color background-image
  background-size background-position background-repeat background-clip background-origin background-blend-mode
  color opacity font font-family font-size font-weight font-style font-variant line-height letter-spacing word-spacing
  text-align text-decoration text-decoration-color text-decoration-style text-transform text-overflow text-shadow
  white-space word-break overflow-wrap vertical-align list-style list-style-type list-style-position
  display grid grid-template grid-template-columns grid-template-rows grid-template-areas grid-auto-columns grid-auto-rows
  grid-auto-flow grid-column grid-column-start grid-column-end grid-row grid-row-start grid-row-end grid-area
  gap row-gap column-gap flex flex-direction flex-wrap flex-flow flex-grow flex-shrink flex-basis
  justify-content justify-items justify-self align-content align-items align-self place-content place-items place-self order
  position top right bottom left inset inset-inline inset-block z-index overflow overflow-x overflow-y
  transform transform-origin transform-style perspective perspective-origin backface-visibility
  animation animation-name animation-duration animation-delay animation-timing-function animation-iteration-count
  animation-direction animation-fill-mode animation-play-state transition transition-property transition-duration
  transition-delay transition-timing-function scroll-behavior scroll-snap-type scroll-snap-align scroll-snap-stop
  scroll-margin scroll-padding scrollbar-width scrollbar-color overscroll-behavior overscroll-behavior-x overscroll-behavior-y
  box-shadow filter backdrop-filter -webkit-backdrop-filter cursor pointer-events user-select -webkit-user-select
  object-fit object-position aspect-ratio visibility isolation mix-blend-mode clip-path
  fill fill-rule fill-opacity stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-dasharray
  stroke-dashoffset text-anchor dominant-baseline paint-order vector-effect stop-color stop-opacity`.split(/\s+/));
const FUNCTIONS = new Set(`url var calc min max clamp rgb rgba hsl hsla hwb lab lch oklab oklch color color-mix
  linear-gradient radial-gradient conic-gradient repeating-linear-gradient repeating-radial-gradient repeating-conic-gradient
  repeat minmax fit-content translate translateX translateY translateZ translate3d scale scaleX scaleY scaleZ scale3d
  rotate rotateX rotateY rotateZ rotate3d skew skewX skewY matrix matrix3d perspective
  cubic-bezier steps linear blur brightness contrast drop-shadow grayscale hue-rotate invert opacity saturate sepia
  inset circle ellipse polygon path`.toLowerCase().split(/\s+/));

export function validateCssStructure(css) {
  const tokens = [];
  let text = '';
  let quote = '';
  const brackets = [];
  for (const char of css) {
    if (quote) {
      text += char;
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
      text += char;
    } else if (char === '(' || char === '[') {
      brackets.push(char);
      text += char;
    } else if (char === ')' || char === ']') {
      if (brackets.pop() !== (char === ')' ? '(' : '[')) return false;
      text += char;
    } else if (!brackets.length && '{};'.includes(char)) {
      tokens.push([char, text.trim()]);
      text = '';
    } else text += char;
  }
  if (quote || brackets.length) return false;
  if (text.trim()) tokens.push([';', text.trim()]);
  const stack = [];
  const declaration = (value) => {
    if (!value) return true;
    const match = /^([A-Za-z-][A-Za-z0-9_-]*)\s*:\s*(.+)$/s.exec(value);
    if (!match) return false;
    const name = match[1].toLowerCase();
    const body = match[2].replace(/\s*!important\s*$/i, '').trim();
    if (!PROPERTIES.has(name) && !/^--[A-Za-z0-9_-]{1,64}$/.test(name)) return false;
    if (name === 'z-index' && !(body === 'auto' || (/^-?[0-9]+$/.test(body) && Number(body) <= 100))) return false;
    const plain = body.replace(/"[^"]*"|'[^']*'/g, '');
    if (/[@{}]/.test(plain)) return false;
    for (const call of plain.matchAll(/([A-Za-z-][A-Za-z0-9-]*)\s*\(/g)) {
      if (!FUNCTIONS.has(call[1].toLowerCase())) return false;
    }
    return true;
  };
  for (const [delimiter, value] of tokens) {
    const context = stack.at(-1);
    if (delimiter === '{') {
      if (context === 'declarations') return false;
      if (/^@(?:media|supports|container|layer)\b/i.test(value)) stack.push('rules');
      else if (/^@(?:-webkit-)?keyframes\s+[A-Za-z_][A-Za-z0-9_-]*$/i.test(value)) stack.push('keyframes');
      else if (value && !value.startsWith('@') && !/:host(?:-context)?\b/i.test(value)
        && (context !== 'keyframes' || /^(?:(?:from|to|[0-9]+(?:\.[0-9]+)?%)\s*,?\s*)+$/i.test(value))) {
        stack.push('declarations');
      } else return false;
    } else if (delimiter === '}') {
      if (!stack.length || (context === 'declarations' ? !declaration(value) : value !== '')) return false;
      stack.pop();
    } else if (context === 'declarations') {
      if (!declaration(value)) return false;
    } else if (value && !/^@import\s+"cms-validated-resource"(?:\s+[^{};]+)?$/i.test(value)) {
      if (stack.length || tokens.some(([kind]) => kind === '{' || kind === '}') || !declaration(value)) return false;
    }
  }
  return !stack.length;
}
