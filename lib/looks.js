// Name bubble styles: each player can pick a color and a pattern for their own
// name in the line. The allowed ids are shared with the browser
// (shared/rules.js); public/js/looks.js draws them.
import { HttpError } from './http.js';
import { LOOK_COLORS, LOOK_TEXTURES } from '../shared/rules.js';

export { LOOK_COLORS, LOOK_TEXTURES };

/** `null` clears the style; anything else must name a known color and pattern. */
export function checkLook(value) {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || !LOOK_COLORS.includes(value.color) || !LOOK_TEXTURES.includes(value.texture)) {
    throw new HttpError(400, 'invalid_look', 'Unknown bubble style');
  }
  return { color: value.color, texture: value.texture };
}
