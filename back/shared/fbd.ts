// 枚举值会入库（FbdTask.status），不可随意调整
export enum FbdTaskStatus {
  pending,   // 0 待审批
  approving, // 1 执行中
  done,      // 2 已通过
  failed,    // 3 失败
  rejected,  // 4 已拒绝
}

export const FBD_STATUS_LABEL: Record<FbdTaskStatus, string> = {
  [FbdTaskStatus.pending]: '待审批',
  [FbdTaskStatus.approving]: '执行中',
  [FbdTaskStatus.done]: '已通过',
  [FbdTaskStatus.failed]: '失败',
  [FbdTaskStatus.rejected]: '已拒绝',
};

// 仅 pending 可审批/拒绝；否则抛错（approve、reject 共用）
export function assertApprovable(status: FbdTaskStatus): void {
  if (status !== FbdTaskStatus.pending) {
    throw new Error('非待审批状态，不可审批');
  }
}

// TODO[fbd]: 接真正写 prd 数据库的逻辑。当前为占位框架。
// 返回值会写入 FbdTask.result；抛错则任务置为 failed。
export async function applyUpdate(type: string, payload: any): Promise<string> {
  switch (type) {
    case 'fedex_rate':
      // TODO: 调用 prd 数据库更新 API / 直连写表
      return 'fedex_rate 占位：已模拟更新成功（未真正写 prd）';
    default:
      throw new Error(`未知任务类型: ${type}`);
  }
}
