#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FedEx Surcharge 检查
new Env('FedEx Surcharge 检查')
cron: 0 8 * * 1

每周一 8 点查生产库新增 FedEx surcharge 项；有数据则在 FBD 中心生成待审批任务并发邮件。
通过容器内 Node CLI 调用查询（复用后端校验 + prd 连接），零额外依赖。
"""
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

DB_FILE = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "db", "database.sqlite")
)
CLI = "/ql/static/build/scripts/fbd-query.js"
FBD_TYPE = "Surcharge"
FBD_SOURCE = "FedEx Surcharge 检查"
TASK_NAME = "FedEx Surcharge 检查"

# 注意：去掉了原 SQL 末尾的 `-- 注释` 和分号，否则过不了查询校验
SQL = (
    "SELECT TOP 100 "
    "s.ServiceType, s.Name AS APIFeeName, s.Explain AS SampleExplain, "
    "DATEADD(MILLISECOND, c.ms % 1000, DATEADD(SECOND, c.ms / 1000, CAST('1970-01-01' AS DATETIME2(3)))) AS CreateTime "
    "FROM ShippingFeeOtherItem s WITH (NOLOCK) "
    "CROSS APPLY (SELECT (s.Id / 4194304) + 1288834974657 AS ms) c "
    "WHERE NOT EXISTS (SELECT 1 FROM MZL_FinanceCustomerBillItem i WITH (NOLOCK) WHERE i.Name = s.Name) "
    "AND s.ServiceType = 'FedEx' "
    "AND s.Name not in ('基础运费','netFreight') "
    "AND DATEADD(MILLISECOND, c.ms % 1000, DATEADD(SECOND, c.ms / 1000, CAST('1970-01-01' AS DATETIME2(3)))) > '2025-10-01' "
    "ORDER BY s.ServiceType, s.Name"
)


def log(msg):
    print(msg, flush=True)


def run_query():
    """调容器内 Node CLI 执行查询，返回 rows 列表；失败抛异常。"""
    proc = subprocess.run(
        ["node", CLI, SQL], capture_output=True, text=True, timeout=120
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"查询 CLI 失败: {proc.stderr.strip() or proc.stdout.strip()}"
        )
    return json.loads(proc.stdout).get("rows", [])


def task_recipients():
    """读取本任务（cron 名 = TASK_NAME）配置的 notify_emails。"""
    import sqlite3
    try:
        conn = sqlite3.connect(DB_FILE, timeout=15)
        row = conn.execute(
            "SELECT notify_emails FROM Crontabs WHERE name=? LIMIT 1", (TASK_NAME,)
        ).fetchone()
        conn.close()
        return (row[0] or "").strip() if row else ""
    except Exception as e:  # noqa: BLE001
        log(f"[通知] 读取任务通知邮箱失败: {e}")
        return ""


def push_fbd_task(rows):
    """生成一条待审批 FBD 任务（type=Surcharge）。"""
    import sqlite3
    title = f"新增 Surcharge 项 待确认 ({len(rows)} 条)"
    payload = {"count": len(rows), "rows": rows}
    local_now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    utc = datetime.now(timezone.utc)
    ts = utc.strftime("%Y-%m-%d %H:%M:%S.") + f"{utc.microsecond // 1000:03d} +00:00"
    try:
        conn = sqlite3.connect(DB_FILE, timeout=15)
        conn.execute(
            "INSERT INTO FbdTasks "
            "(title, type, source, payload, status, result, operator, "
            "MZL_PriceID, timestamp, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (
                title,
                FBD_TYPE,
                FBD_SOURCE,
                json.dumps(payload, ensure_ascii=False),
                0,
                "",
                "",
                json.dumps({}),
                local_now,
                ts,
                ts,
            ),
        )
        conn.commit()
        conn.close()
        log(f"[FBD] 已生成待审批任务：{title}")
        return True
    except Exception as e:  # noqa: BLE001
        log(f"[FBD] 生成任务失败: {e}")
        return False


def try_notify(rows):
    try:
        from notify import send, push_config
        recipients = task_recipients()
        if recipients:
            push_config["SMTP_EMAIL_TO"] = recipients
        preview = "\n".join(
            f"- {r.get('APIFeeName')} ({r.get('ServiceType')})" for r in rows[:20]
        )
        content = (
            f"检测到 {len(rows)} 个新增 FedEx Surcharge 项待确认：\n\n"
            + preview
            + ("\n..." if len(rows) > 20 else "")
            + "\n\n请到 FBD 中心确认。"
        )
        send("FedEx 新增 Surcharge 项待确认", content)
    except Exception as e:  # noqa: BLE001
        log(f"[通知] 发送失败（不影响结果）: {e}")


def main():
    rows = run_query()
    log(f"[查询] 返回 {len(rows)} 行")
    if not rows:
        log("[结果] 无新增 surcharge 项，不建任务、不发邮件。")
        return
    if push_fbd_task(rows):
        try_notify(rows)
    else:
        log("[结果] 任务生成失败，跳过邮件。")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        log(f"[错误] 任务执行失败: {e}")
        sys.exit(1)
