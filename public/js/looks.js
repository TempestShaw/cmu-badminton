// How name bubbles look: 12 colors × 8 patterns. The ids must match
// lib/looks.js, which is what the server accepts.

/** bg: bubble color; ink: text and pattern color that stay readable on it. */
export const COLORS = {
  scarlet: { label: 'Scarlet', bg: '#c41230', ink: '#ffffff' },
  tangerine: { label: 'Tangerine', bg: '#f76707', ink: '#1a1a1a' },
  lemon: { label: 'Lemon', bg: '#fcc419', ink: '#1a1a1a' },
  lime: { label: 'Lime', bg: '#94d82d', ink: '#1a1a1a' },
  mint: { label: 'Mint', bg: '#63e6be', ink: '#1a1a1a' },
  teal: { label: 'Teal', bg: '#0b7285', ink: '#ffffff' },
  sky: { label: 'Sky', bg: '#74c0fc', ink: '#1a1a1a' },
  indigo: { label: 'Indigo', bg: '#3b5bdb', ink: '#ffffff' },
  grape: { label: 'Grape', bg: '#862e9c', ink: '#ffffff' },
  pink: { label: 'Pink', bg: '#f783ac', ink: '#1a1a1a' },
  slate: { label: 'Slate', bg: '#343a40', ink: '#ffffff' },
  sand: { label: 'Sand', bg: '#e9d8a6', ink: '#1a1a1a' },
};

// Each pattern is one SVG tile, drawn in the color's ink at low opacity.
// `{ink}` is replaced with that color.
export const TEXTURES = {
  plain: { label: 'Plain', size: null, svg: '' },
  dots: {
    label: 'Dots', size: 12,
    svg: '<circle cx="3" cy="3" r="1.6" fill="{ink}"/><circle cx="9" cy="9" r="1.6" fill="{ink}"/>',
  },
  stripes: {
    label: 'Stripes', size: 10,
    svg: '<path d="M-2 12L12-2M8 12l4-4M-2 2l4-4" stroke="{ink}" stroke-width="2.5"/>',
  },
  checks: {
    label: 'Checks', size: 12,
    svg: '<rect width="6" height="6" fill="{ink}"/><rect x="6" y="6" width="6" height="6" fill="{ink}"/>',
  },
  waves: {
    label: 'Waves', size: 20,
    svg: '<path d="M0 6q5-5 10 0t10 0M0 16q5-5 10 0t10 0" fill="none" stroke="{ink}" stroke-width="1.6"/>',
  },
  zigzag: {
    label: 'Zigzag', size: 12,
    svg: '<path d="M0 8l3-4 3 4 3-4 3 4" fill="none" stroke="{ink}" stroke-width="1.6"/>',
  },
  confetti: {
    label: 'Confetti', size: 28,
    svg: '<rect x="3" y="4" width="5" height="2" rx="1" transform="rotate(30 5 5)" fill="{ink}"/>'
      + '<rect x="17" y="15" width="5" height="2" rx="1" transform="rotate(-40 19 16)" fill="{ink}"/>'
      + '<circle cx="20" cy="5" r="1.5" fill="{ink}"/><circle cx="7" cy="20" r="1.5" fill="{ink}"/>'
      + '<rect x="11" y="10" width="2.5" height="2.5" transform="rotate(20 12 11)" fill="{ink}"/>',
  },
  shuttles: {
    label: 'Shuttles', size: 24,
    svg: '<g transform="rotate(-30 12 12)" fill="{ink}"><path d="M8.5 4h7l-2 8h-3z"/><circle cx="12" cy="14.5" r="2.6"/></g>',
  },
};

const PATTERN_OPACITY = 0.22;

/** Accepts only known ids, so a stray value from the network can't style anything. */
export function validLook(look) {
  return look && Object.hasOwn(COLORS, look.color) && Object.hasOwn(TEXTURES, look.texture) ? look : null;
}

function patternImage(texture, ink) {
  const { size, svg } = TEXTURES[texture];
  if (!size) return 'none';
  const tile = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">`
    + `<g opacity="${PATTERN_OPACITY}">${svg.replaceAll('{ink}', ink)}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(tile)}")`;
}

/** Inline style for a bubble, or null for the default look. */
export function lookStyle(look) {
  const valid = validLook(look);
  if (!valid) return null;
  const { bg, ink } = COLORS[valid.color];
  return `--look-bg:${bg};--look-ink:${ink};background-image:${patternImage(valid.texture, ink)}`;
}

export const COMBINATIONS = Object.keys(COLORS).length * Object.keys(TEXTURES).length;
