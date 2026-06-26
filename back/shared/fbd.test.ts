import { test } from 'node:test';
import assert from 'node:assert';
import {
  FbdTaskStatus,
  FBD_STATUS_LABEL,
  assertApprovable,
  applyUpdate,
} from './fbd';

test('五状态枚举值固定为 0..4', () => {
  assert.strictEqual(FbdTaskStatus.pending, 0);
  assert.strictEqual(FbdTaskStatus.approving, 1);
  assert.strictEqual(FbdTaskStatus.done, 2);
  assert.strictEqual(FbdTaskStatus.failed, 3);
  assert.strictEqual(FbdTaskStatus.rejected, 4);
});

test('每个状态都有中文标签', () => {
  assert.strictEqual(FBD_STATUS_LABEL[FbdTaskStatus.pending], '待审批');
  assert.strictEqual(FBD_STATUS_LABEL[FbdTaskStatus.approving], '执行中');
  assert.strictEqual(FBD_STATUS_LABEL[FbdTaskStatus.done], '已通过');
  assert.strictEqual(FBD_STATUS_LABEL[FbdTaskStatus.failed], '失败');
  assert.strictEqual(FBD_STATUS_LABEL[FbdTaskStatus.rejected], '已拒绝');
});

test('assertApprovable 仅放行 pending，其它状态抛错', () => {
  assert.doesNotThrow(() => assertApprovable(FbdTaskStatus.pending));
  assert.throws(() => assertApprovable(FbdTaskStatus.done), /非待审批/);
  assert.throws(() => assertApprovable(FbdTaskStatus.rejected), /非待审批/);
  assert.throws(() => assertApprovable(FbdTaskStatus.approving), /非待审批/);
});

test('applyUpdate fedex_rate 返回成功摘要', async () => {
  const r = await applyUpdate('fedex_rate', {});
  assert.match(r, /fedex_rate/);
});

test('applyUpdate 未知类型抛错', async () => {
  await assert.rejects(() => applyUpdate('unknown', {}), /未知任务类型/);
});
