import test from 'node:test';
import assert from 'node:assert/strict';
import { planEntryIdMigration, OLD_ENTRY_ID, NEW_ENTRY_ID } from '../tools/entry-id-migration.mjs';

test('entry-ID migration preserves enabled and disabled overrides without mutating input', () => {
  for (const disabled of [true, false]) {
    const before = [{ id: 'unrelated', disabled: true }, { id: OLD_ENTRY_ID, name: OLD_ENTRY_ID, disabled,
      config: { label: OLD_ENTRY_ID, nested: { keep: true } } }];
    const snapshot = structuredClone(before);
    const after = planEntryIdMigration(before);
    assert.deepEqual(before, snapshot);
    assert.deepEqual(after, [before[0], { ...before[1], id: NEW_ENTRY_ID }]);
    assert.notEqual(after[1].config, before[1].config);
  }
});
test('entry-ID migration preserves override order and is idempotent', () => {
  const before = [{ id: OLD_ENTRY_ID, disabled: true }, { id: OLD_ENTRY_ID, disabled: false }];
  const after = planEntryIdMigration(before);
  assert.deepEqual(after.map(p => [p.id, p.disabled]), [[NEW_ENTRY_ID, true], [NEW_ENTRY_ID, false]]);
  assert.deepEqual(planEntryIdMigration(after), after);
  assert.deepEqual(planEntryIdMigration([]), []);
});
test('entry-ID migration refuses existing new-ID overrides or insertions', () => {
  assert.throws(() => planEntryIdMigration([{ id: OLD_ENTRY_ID }, { id: NEW_ENTRY_ID }]), /Both entry IDs/);
  assert.throws(() => planEntryIdMigration([{ id: OLD_ENTRY_ID }, { insert: [{ id: 'group', group: true,
    config: [{ id: NEW_ENTRY_ID, name: 'another-plugin' }] }] }]), /Both entry IDs/);
});
test('entry-ID migration refuses custom ownership or inserted old rows', () => {
  assert.throws(() => planEntryIdMigration([{ id: OLD_ENTRY_ID, name: 'another-plugin' }]), /manual review/);
  assert.throws(() => planEntryIdMigration([{ id: OLD_ENTRY_ID, insert: [] }]), /manual review/);
  assert.throws(() => planEntryIdMigration([{ insert: [{ id: OLD_ENTRY_ID, name: OLD_ENTRY_ID }] }]), /manual review/);
  assert.throws(() => planEntryIdMigration(null), /patch list/);
  assert.throws(() => planEntryIdMigration([null]), /patch list/);
});
