// 取文本末尾 N 行（忽略末尾连续空行），用于任务完成邮件附日志尾部
export function tailLines(content: string, n: number): string {
  if (!content) return '';
  const lines = content.split(/\r?\n/);
  while (lines.length && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.slice(-n).join('\n');
}
