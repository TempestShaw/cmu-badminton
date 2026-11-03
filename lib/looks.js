// Name bubble styles: each player can pick a color and a pattern for their own
// name in the line. Only the ids live here; public/js/looks.js draws them, so
// keep the two lists in step.
import { HttpError } from './http.js';

export const LOOK_COLORS = ['scarlet', 'tangerine', 'lemon', 'lime', 'mint', 'teal', 'sky', 'indigo', 'grape', 'pink', 'slate', 'sand'];
export const LOOK_TEXTURES = ['plain', 'dots', 'stripes', 'checks', 'waves', 'zigzag', 'confetti', 'shuttles'];

/** `null` clears the style; anything else must name a known color and pattern. */
export function checkLook(value) {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || !LOOK_COLORS.includes(value.color) || !LOOK_TEXTURES.includes(value.texture)) {
    throw new HttpError(400, 'invalid_look', 'Unknown bubble style');
  }
  return { color: value.color, texture: value.texture };
}
