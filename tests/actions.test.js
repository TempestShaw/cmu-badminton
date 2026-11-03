// Whole actions: revisions, what the public sees, the day's lifecycle, alerts
// and the wrong-PIN lockout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore } from '../lib/store.js';
import { toPublic } from '../lib/queue.js';
import { guardHostPin } from '../lib/pin-guard.js';
import {
  newDay, PIN, errorCode,
} from './helpers.js';

test('every saved change gets the next revision; a no-op changes nothing', async () => {
  const day = await newDay();
  const before = await day.state();
  const id = await day.person('Alex');
  const after = await day.state();
  assert.ok(after.rev > before.rev);
  const noop = await day.host({ type: 'verify' });
  assert.equal(noop.changed, false);
  assert.equal(noop.state.rev, after.rev);
  const joined = await day.run({ type: 'join', playerId: id, groupId: 'auto' });
  assert.equal(joined.changed, true);
  assert.equal(joined.state.rev, after.rev + 1);
});

test('the public view hides player ids and today\'s code', async () => {
  const day = await newDay();
  const id = await day.person('Alex');
  await day.run({ type: 'join', playerId: id, groupId: 'auto' });
  const text = JSON.stringify(toPublic(await day.state()));
  assert.ok(!text.includes(id), 'no player id');
  assert.ok(!text.includes(`"${day.code}"`), 'no code');
  assert.match(text, /"rev":\d+/);
});

test('check-in needs today\'s code; names are unique for the day (any case)', async () => {
  const day = await newDay();
  await day.person('Alex');
  assert.equal(await errorCode(() => day.run({ type: 'checkIn', playerId: crypto.randomUUID(), name: 'Bo', code: 'ZZZZ' })), 'bad_code');
  assert.equal(await errorCode(() => day.run({ type: 'checkIn', playerId: crypto.randomUUID(), name: 'alex', code: day.code })), 'name_taken');
});

test('a new code stops the old one; ending the day needs the password again and can be undone', async () => {
  const day = await newDay();
  const { code: fresh } = (await day.host({ type: 'newCode' })).result;
  assert.equal(await errorCode(() => day.run({ type: 'checkIn', playerId: crypto.randomUUID(), name: 'Late', code: day.code })), 'bad_code');
  await day.run({ type: 'checkIn', playerId: crypto.randomUUID(), name: 'OnTime', code: fresh });
  assert.equal(await errorCode(() => day.host({ type: 'endDay' })), 'confirm_pin');
  assert.equal(await errorCode(() => day.host({ type: 'endDay', confirmPin: 'nope' })), 'confirm_pin');
  const ended = await day.host({ type: 'endDay', confirmPin: PIN });
  assert.equal(ended.state.session, null);
  const back = await day.host({ type: 'restoreDay' });
  assert.ok(back.state.roster.some((m) => m.name === 'OnTime'));
});

test('host-only and court-screen actions are refused without the right credentials', async () => {
  const day = await newDay();
  assert.equal(await errorCode(() => day.run({ type: 'startDay' })), 'not_host');
  assert.equal(await errorCode(() => day.run({ type: 'sessionInfo' })), 'not_kiosk');
  assert.equal(await errorCode(() => day.run({ type: 'startDay' }, { hostPin: 'wrong' })), 'not_host');
});

test('name bubbles: only known colors and patterns', async () => {
  const day = await newDay();
  const id = await day.person('Alex');
  const ok = await day.run({ type: 'setLook', playerId: id, look: { color: 'teal', texture: 'dots' } });
  assert.deepEqual(ok.state.roster[0].look, { color: 'teal', texture: 'dots' });
  assert.equal(await errorCode(() => day.run({ type: 'setLook', playerId: id, look: { color: 'red', texture: 'dots' } })), 'invalid_look');
});

test('alerts: called groups, a court held for a short group (once), and the new first in line', async () => {
  const day = await newDay();
  const [g1, g2] = await day.fillCourts();
  await day.group(['S1', 'S2']);
  await day.group(['F1', 'F2', 'F3', 'F4']);
  const first = await day.host({ type: 'finish', courtNo: 1, groupId: g1 });
  assert.deepEqual(first.effects.map((e) => `${e.kind}:${e.group.no}`), ['courtFree:4']);
  const second = await day.host({ type: 'finish', courtNo: 2, groupId: g2 });
  assert.deepEqual(second.effects.map((e) => `${e.kind}:${e.group.no}`), ['called:5'], 'the short group isn\'t told twice');
});

test('ten wrong host PINs from one network lock it for everyone there, the right PIN included', async () => {
  const store = memoryStore();
  for (let i = 0; i < 10; i++) await guardHostPin(store, '1.2.3.4', `wrong-${i}`);
  assert.equal(await errorCode(() => guardHostPin(store, '1.2.3.4', 'wrong-again')), 'pin_locked');
  assert.equal(await errorCode(() => guardHostPin(store, '1.2.3.4', PIN)), 'pin_locked');
  assert.equal(await errorCode(() => guardHostPin(store, '5.6.7.8', PIN)), null, 'other networks are unaffected');
  assert.equal(await errorCode(() => guardHostPin(store, '9.9.9.9', null)), null, 'no PIN, no check');
});
