// Line order and courts: who goes on, who may start early, and the host's undo tools.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newDay, onCourts, line, errorCode,
} from './helpers.js';

test('full groups take the courts in line order; the fourth waits', async () => {
  const day = await newDay();
  await day.fillCourts();
  await day.group(['D1', 'D2', 'D3', 'D4']);
  const s = await day.state();
  assert.equal(onCourts(s), '1,2,3');
  assert.equal(line(s), '4:4');
});

test('ending a game calls the next full group to that court; ending it twice is harmless', async () => {
  const day = await newDay();
  const [g1] = await day.fillCourts();
  await day.group(['D1', 'D2', 'D3', 'D4']);
  const { state } = await day.run({ type: 'finish', courtNo: 1, groupId: g1, playerId: day.idOf('A1') });
  assert.equal(onCourts(state), '4,2,3');
  const again = await day.run({ type: 'finish', courtNo: 1, groupId: g1, playerId: day.idOf('A1') });
  assert.equal(onCourts(again.state), '4,2,3');
});

test('only players in a game can end it from a phone', async () => {
  const day = await newDay();
  const [g1] = await day.fillCourts();
  await day.person('Outsider');
  assert.equal(await errorCode(() => day.run({ type: 'finish', courtNo: 1, groupId: g1, playerId: day.idOf('Outsider') })), 'not_in_group');
});

test('one free court: a full group never jumps a short group ahead of it', async () => {
  const day = await newDay();
  const [g1] = await day.fillCourts();
  const short = await day.group(['S1', 'S2']);
  const full = await day.group(['F1', 'F2', 'F3', 'F4']);
  const { state } = await day.host({ type: 'finish', courtNo: 1, groupId: g1 });
  assert.equal(onCourts(state), '-,2,3', 'court 1 stays free for the short group');
  assert.equal(await errorCode(() => day.run({ type: 'start', groupId: full, playerId: day.idOf('F1') })), 'not_first');
  const started = await day.run({ type: 'start', groupId: short, playerId: day.idOf('S1') });
  assert.equal(onCourts(started.state), '4,2,3');
});

test('the court screen or host can still start any group (exceptions)', async () => {
  const day = await newDay();
  const [g1] = await day.fillCourts();
  await day.group(['S1', 'S2']);
  const full = await day.group(['F1', 'F2', 'F3', 'F4']);
  await day.host({ type: 'finish', courtNo: 1, groupId: g1 });
  const { state } = await day.host({ type: 'start', groupId: full });
  assert.equal(onCourts(state), '5,2,3');
});

test('three free courts: a short group holds one; full groups behind take the rest', async () => {
  const day = await newDay();
  const busy = await day.fillCourts();
  await day.group(['S1', 'S2']);
  await day.group(['F1', 'F2', 'F3', 'F4']);
  await day.group(['G1', 'G2', 'G3', 'G4']);
  for (const [i, id] of busy.entries()) await day.host({ type: 'finish', courtNo: i + 1, groupId: id });
  const s = await day.state();
  assert.equal(onCourts(s), '5,6,-');
  assert.equal(line(s), '4:2');
});

test('a short group starting lets full groups behind it take the other free courts at once', async () => {
  const day = await newDay();
  const busy = await day.fillCourts();
  const short = await day.group(['S1', 'S2']);
  await day.group(['S3']); // a second short group: two courts end up held
  await day.group(['F1', 'F2', 'F3', 'F4']);
  for (const [i, id] of busy.entries()) await day.host({ type: 'finish', courtNo: i + 1, groupId: id });
  assert.equal(onCourts(await day.state()), '6,-,-', 'two courts held for the two short groups');
  const { state } = await day.run({ type: 'start', groupId: short, playerId: day.idOf('S1') });
  assert.equal(onCourts(state), '6,4,-');
});

test('each short group holding a court may start; one further back may not', async () => {
  const day = await newDay();
  const busy = await day.fillCourts();
  await day.group(['S1', 'S2']);
  const second = await day.group(['T1']);
  const third = await day.group(['U1']);
  await day.host({ type: 'finish', courtNo: 1, groupId: busy[0] });
  await day.host({ type: 'finish', courtNo: 2, groupId: busy[1] });
  assert.equal(await errorCode(() => day.run({ type: 'start', groupId: third, playerId: day.idOf('U1') })), 'not_first');
  const { state } = await day.run({ type: 'start', groupId: second, playerId: day.idOf('T1') });
  assert.equal(onCourts(state), '5,-,3');
});

test('Back to line frees the court without starting that group again', async () => {
  const day = await newDay();
  const [g1] = await day.fillCourts();
  const { state } = await day.host({ type: 'backToLine', groupId: g1 });
  assert.equal(onCourts(state), '-,2,3');
  assert.equal(line(state), '1:4');
});

test('Undo end puts a game back on its court; Bring back returns a removed group', async () => {
  const day = await newDay();
  const [g1] = await day.fillCourts();
  await day.host({ type: 'finish', courtNo: 1, groupId: g1 });
  const undone = await day.host({ type: 'reopen', groupId: g1 });
  assert.equal(onCourts(undone.state), '1,2,3');
  const extra = await day.group(['D1']);
  await day.host({ type: 'disband', groupId: extra });
  const back = await day.host({ type: 'reopen', groupId: extra });
  assert.equal(line(back.state), '4:1');
});
