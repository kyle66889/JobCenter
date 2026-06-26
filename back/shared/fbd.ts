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
