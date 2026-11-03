// Joining, moving and taking people out: parties stay together, nobody is lost
// or duplicated, and a change based on an outdated screen is refused whole.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newDay, onCourts, line, spotsAreUnique, errorCode,
} from './helpers.js';

test('joining "auto" fills the first group with room', async () => {
  const day = await newDay();
  await day.fillCourts();
  await day.group(['D1', 'D2', 'D3']);
  await day.group(['E1']);
  const id = await day.person('New');
  const { state } = await day.run({ type: 'join', playerId: id, groupId: 'auto' });
  assert.equal(line(state), '4:4 5:1');
});

test('a party signed up together stays together', async () => {
  const day = await newDay();
  await day.fillCourts();
  await day.group(['D1', 'D2', 'D3']); // one spot: too small for a party of three
  const me = await day.person('Victor');
  const { state } = await day.run({ type: 'joinTogether', playerId: me, includeMe: true, names: ['Ben', 'Cat'], groupId: 'auto' });
  const party = state.groups.find((g) => g.players.some((p) => p.name === 'Victor'));
  assert.deepEqual(party.players.map((p) => p.name).sort(), ['Ben', 'Cat', 'Victor']);
  assert.equal(line(state), '4:3 5:3');
});

test('one spot per person in line, a second while playing, never a third', async () => {
  const day = await newDay();
  await day.fillCourts();
  const playing = day.idOf('A1');
  await day.run({ type: 'join', playerId: playing, groupId: 'new' });
  assert.equal(await errorCode(() => day.run({ type: 'join', playerId: playing, groupId: 'new' })), 'signup_limit');
});

test('moving someone who was already moved elsewhere is refused', async () => {
  const day = await newDay();
  await day.fillCourts();
  const from = await day.group(['D1', 'D2']);
  const to = await day.group(['E1']);
  const key = day.keyOfName('D1');
  await day.run({ type: 'movePlayer', playerId: day.idOf('D1'), playerKey: key, fromGroupId: from, groupId: to });
  assert.equal(await errorCode(() => day.run({ type: 'movePlayer', playerId: day.idOf('D1'), playerKey: key, fromGroupId: from, groupId: 'new' })), 'moved_already');
});

test('a group emptied by leaving disappears from the line', async () => {
  const day = await newDay();
  await day.fillCourts();
  await day.group(['D1']);
  await day.group(['E1', 'E2']);
  const { state } = await day.run({ type: 'leave', playerId: day.idOf('D1') });
  assert.equal(line(state), '5:2');
});

test('court screen: up to four people from different groups move together', async () => {
  const day = await newDay();
  await day.fillCourts();
  const d = await day.group(['D1', 'D2']);
  const e = await day.group(['E1']);
  const moves = [{ playerKey: day.keyOfName('D1'), fromGroupId: d }, { playerKey: day.keyOfName('E1'), fromGroupId: e }];
  const { state } = await day.host({ type: 'movePlayers', moves, groupId: 'new' });
  assert.equal(line(state), '4:1 6:2');
  assert.ok(spotsAreUnique(state));
});

test('court screen: not enough room means nobody moves', async () => {
  const day = await newDay();
  await day.fillCourts();
  const d = await day.group(['D1', 'D2']);
  const e = await day.group(['E1', 'E2', 'E3']);
  const moves = [{ playerKey: day.keyOfName('D1'), fromGroupId: d }, { playerKey: day.keyOfName('D2'), fromGroupId: d }];
  assert.equal(await errorCode(() => day.host({ type: 'movePlayers', moves, groupId: e })), 'group_full');
  assert.equal(line(await day.state()), '4:2 5:3');
});

test('court screen: if anyone picked has moved meanwhile, nobody moves', async () => {
  const day = await newDay();
  await day.fillCourts();
  const d = await day.group(['D1', 'D2']);
  const e = await day.group(['E1']);
  // D1 moves on their own phone after being picked.
  await day.run({ type: 'movePlayer', playerId: day.idOf('D1'), playerKey: day.keyOfName('D1'), fromGroupId: d, groupId: e });
  const moves = [{ playerKey: day.keyOfName('D1'), fromGroupId: d }, { playerKey: day.keyOfName('D2'), fromGroupId: d }];
  assert.equal(await errorCode(() => day.host({ type: 'movePlayers', moves, groupId: 'new' })), 'moved_already');
  assert.equal(line(await day.state()), '4:1 5:2');
});

test('court screen: removing people keeps them checked in; an emptied short first group frees its court', async () => {
  const day = await newDay();
  const [g1] = await day.fillCourts();
  const short = await day.group(['S1', 'S2']);
  await day.group(['F1', 'F2', 'F3', 'F4']);
  await day.host({ type: 'finish', courtNo: 1, groupId: g1 });
  const picks = [{ playerKey: day.keyOfName('S1'), fromGroupId: short }, { playerKey: day.keyOfName('S2'), fromGroupId: short }];
  const { state } = await day.host({ type: 'removePlayers', picks });
  assert.equal(onCourts(state), '5,2,3', 'the full group behind takes the court');
  assert.ok(state.roster.some((m) => m.name === 'S1'), 'still checked in');
});

test('phones can\'t use the court screen\'s group moves or removals', async () => {
  const day = await newDay();
  await day.fillCourts();
  const d = await day.group(['D1']);
  const picks = [{ playerKey: day.keyOfName('D1'), fromGroupId: d }];
  assert.equal(await errorCode(() => day.run({ type: 'removePlayers', picks })), 'not_kiosk');
  assert.equal(await errorCode(() => day.run({ type: 'movePlayers', moves: picks, groupId: 'new' })), 'not_kiosk');
});

test('many people joining at once: nobody lost or duplicated', async () => {
  const day = await newDay();
  const ids = [];
  for (let i = 0; i < 30; i++) ids.push(await day.person(`P${i}`));
  // The real random wait between retries (tests otherwise skip it for speed).
  const realBackoff = { backoff: undefined };
  await Promise.all(ids.map((id) => day.run({ type: 'join', playerId: id, groupId: 'auto' }, realBackoff)));
  const s = await day.state();
  const spots = s.groups.filter((g) => g.status !== 'done' && g.status !== 'removed').flatMap((g) => g.players);
  assert.equal(spots.length, 30);
  assert.ok(spotsAreUnique(s));
  assert.ok(s.groups.every((g) => g.players.length <= 4));
});
