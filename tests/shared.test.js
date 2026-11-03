// The rules shared by server and browser stay in step with what each side builds on them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOOK_COLORS, LOOK_TEXTURES, GROUP_SIZE } from '../shared/rules.js';
import { COLORS, TEXTURES, lookStyle } from '../public/js/looks.js';
import * as queue from '../lib/queue.js';

test('every allowed bubble color and pattern has a drawing, and nothing else does', () => {
  assert.deepEqual(Object.keys(COLORS).sort(), [...LOOK_COLORS].sort());
  assert.deepEqual(Object.keys(TEXTURES).sort(), [...LOOK_TEXTURES].sort());
  for (const color of LOOK_COLORS) {
    for (const texture of LOOK_TEXTURES) assert.ok(lookStyle({ color, texture }), `${color} + ${texture}`);
  }
});

test('the server re-exports the shared rules unchanged', async () => {
  const shared = await import('../shared/rules.js');
  assert.equal(queue.GROUP_SIZE, GROUP_SIZE);
  assert.equal(queue.startableGroups, shared.startableGroups);
  assert.equal(queue.waitingGroups, shared.waitingGroups);
  assert.equal(queue.isActive, shared.isActive);
});
