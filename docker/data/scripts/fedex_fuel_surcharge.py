#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FedEx Fuel Surcharge 抓取任务
new Env('FedEx Fuel Surcharge')
cron: 0 8 * * *

抓取 https://www.fedex.com/en-us/shipping/fuel-surcharge.html 的当前生效燃油附加费：
  - FedEx Ground（柴油价）
  - FedEx Express 国内包裹（航空燃油价）
  - FedEx Express Freight 出口/进口
每次记录到日志；与上次相比有变化时，用青龙内置 notify 发邮件。
零额外依赖（仅用 Python 标准库）。
"""
import json
import os
import re
import sys
import gzip
import html as _html
from datetime import datetime, date, timezone
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

URL = "https://www.fedex.com/en-us/shipping/fuel-surcharge.html"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".fedex_fuel_state.json")

PCT_RE = re.compile(r"^\d+(?:\.\d+)?%$")

# ---- FBD 中心：把抓到的费率作为一条「待审批」任务写入 FBD 中心 ----
# 暂时测试用：直连容器内 sqlite（脚本与 DB 同在 /ql/data 卷），免鉴权、零额外依赖。
# 生产化时改为带 scope 的 open API 推送（见 spec 2026-06-25-fbd-center-design.md 第 6 节）。
DB_FILE = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "db", "database.sqlite")
)
FBD_TYPE = "fedex_fuel_charge"       # 与前端创建表单的类型值一致
FBD_SOURCE = "FedEx Fuel Surcharge"  # 定时任务名作为来源


def log(msg):
    print(msg, flush=True)


def fetch_html(retries=3):
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            req = Request(URL, headers={
                "User-Agent": UA,
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "gzip",
            })
            with urlopen(req, timeout=30) as resp:
                raw = resp.read()
                if resp.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                return raw.decode("utf-8", errors="ignore")
        except (URLError, HTTPError, OSError) as e:
            last_err = e
            log(f"[抓取] 第 {attempt}/{retries} 次失败: {e}")
    raise RuntimeError(f"抓取页面失败: {last_err}")


def cell_text(td_html):
    txt = re.sub(r"<[^>]+>", " ", td_html)
    txt = _html.unescape(txt)
    return re.sub(r"\s+", " ", txt).strip()


def parse_rates_table(html):
    """解析页面第一个表格（当前费率表），返回每周数据行的单元格列表。"""
    tables = re.findall(r"<table.*?</table>", html, flags=re.S | re.I)
    if not tables:
        raise RuntimeError("页面没有找到任何表格，结构可能已变化")
    rows = re.findall(r"<tr.*?</tr>", tables[0], flags=re.S | re.I)
    data_rows = []
    for r in rows:
        cells = [cell_text(c) for c in
                 re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", r, flags=re.S | re.I)]
        # 数据行：至少含一个百分比单元格
        if any(PCT_RE.match(c) for c in cells):
            data_rows.append(cells)
    if not data_rows:
        raise RuntimeError("当前费率表里没有解析到带百分比的数据行")
    return data_rows


def parse_date_range(text):
    """'June 22, 2026–June 28, 2026' -> (date, date)；解析失败返回 (None, None)。"""
    parts = re.split(r"[–-]", text)
    try:
        if len(parts) == 2:
            start = datetime.strptime(parts[0].strip(), "%B %d, %Y").date()
            end = datetime.strptime(parts[1].strip(), "%B %d, %Y").date()
            return start, end
        one = datetime.strptime(text.strip(), "%B %d, %Y").date()
        return one, one
    except ValueError:
        return None, None


def pick_current_row(data_rows):
    """选取生效日期区间包含今天的那一行；找不到则取最上面（最新）一行。"""
    today = date.today()
    for cells in data_rows:
        start, end = parse_date_range(cells[0])
        if start and end and start <= today <= end:
            return cells, True
    return data_rows[0], False


def extract(cells):
    """提取当前行的费率。

    页面当前表格每行 7 列：
      [0] Ground 生效周期  [1] Ground %       [2] Express 生效日期
      [3] 国内包裹 %       [4] Freight 单价($/lb)
      [5] 出口/进口(Export & Import) %        [6] 出口/进口 生效日期
    注意：页面只有一个合并的 "Export & Import" 费率，没有单独的进口百分比，
    第 [6] 列是日期而非百分比。

    百分比列改用模式匹配（按出现顺序：Ground、国内包裹、出口/进口），
    抗未来表格再插入日期列导致的列错位。
    """
    def at(i):
        return cells[i] if i < len(cells) else ""

    pcts = [c for c in cells if PCT_RE.match(c)]
    rate = next((c for c in cells if "lb" in c.lower() or "/kg" in c.lower()), at(4))

    return {
        "ground_effective": at(0),
        "ground": pcts[0] if len(pcts) >= 1 else at(1),
        "express_effective": at(2),
        "express_package": pcts[1] if len(pcts) >= 2 else at(3),
        "express_freight_rate": rate,
        "export_import": pcts[-1] if len(pcts) >= 3 else at(5),
        "export_import_effective": at(6),
    }


def load_state():
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_state(state):
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
    except OSError as e:
        log(f"[状态] 写入状态文件失败: {e}")


# 参与变化比对 / 邮件提醒的字段
WATCH = [
    ("ground", "FedEx Ground"),
    ("express_package", "FedEx Express 国内包裹"),
    ("export_import", "Express Freight 出口/进口"),
]


def task_recipients():
    """读取本任务（按 cron 名 = FBD_SOURCE）在面板上配置的通知邮箱 notify_emails。"""
    import sqlite3

    try:
        conn = sqlite3.connect(DB_FILE, timeout=15)
        row = conn.execute(
            "SELECT notify_emails FROM Crontabs WHERE name=? LIMIT 1", (FBD_SOURCE,)
        ).fetchone()
        conn.close()
        return (row[0] or "").strip() if row else ""
    except Exception as e:  # noqa: BLE001
        log(f"[通知] 读取任务通知邮箱失败: {e}")
        return ""


def try_notify(title, content, recipients=""):
    try:
        from notify import send, push_config

        # 收件人＝任务的 notify_emails（在任务编辑页里管）；为空则回退 config.sh 的 SMTP_EMAIL_TO
        if recipients:
            push_config["SMTP_EMAIL_TO"] = recipients
        send(title, content)
    except Exception as e:  # noqa: BLE001  通知失败不应让任务标记为失败
        log(f"[通知] 发送失败（不影响抓取结果）: {e}")


def push_fbd_task(cur, changes=None):
    """把当前抓到的燃油附加费写入 FBD 中心，状态＝待审批（待处理），等待人工审批。
    仅在费率变化时调用；失败不影响抓取任务本身。"""
    import sqlite3

    title = (
        f"FedEx 燃油附加费 待审批 "
        f"{cur.get('ground_effective') or datetime.now().strftime('%Y-%m-%d')}"
    )
    payload = {
        k: cur.get(k)
        for k in (
            "ground_effective",
            "ground",
            "express_effective",
            "express_package",
            "express_freight_rate",
            "export_import",
            "export_import_effective",
        )
    }
    payload["source_url"] = URL
    if changes:
        payload["changes"] = changes  # 本次相对上次的变化明细

    mzl_price_id = json.dumps(
        {
            "ground": os.environ.get("FEDEX_FUEL_GROUND_ID", ""),
            "express": os.environ.get("FEDEX_FUEL_EXPRESS_ID", ""),
        },
        ensure_ascii=False,
    )
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
                0,  # status=0 待审批
                "",
                "",
                mzl_price_id,
                local_now,
                ts,
                ts,
            ),
        )
        conn.commit()
        conn.close()
        log(f"[FBD] 已生成待审批任务：{title}")
    except Exception as e:  # noqa: BLE001
        log(f"[FBD] 生成任务失败（不影响抓取）: {e}")


def main():
    html = fetch_html()
    data_rows = parse_rates_table(html)
    cells, matched_today = pick_current_row(data_rows)
    cur = extract(cells)

    tag = "（按今日日期匹配）" if matched_today else "（未匹配到今日，取最新一行）"
    log("=" * 48)
    log(f"FedEx 燃油附加费 当前生效值 {tag}")
    log(f"  生效周期(Ground): {cur['ground_effective']}")
    log(f"  生效日期(Express): {cur['express_effective']}")
    log(f"  FedEx Ground          : {cur['ground']}")
    log(f"  FedEx Express 国内包裹 : {cur['express_package']}")
    log(f"  Express Freight 单价   : {cur['express_freight_rate']}")
    log(f"  Express Freight 出口/进口: {cur['export_import']}")
    log(f"  出口/进口 生效日期      : {cur['export_import_effective']}")
    log("=" * 48)

    prev = load_state()
    changes = []
    for key, label in WATCH:
        old = prev.get(key)
        new = cur.get(key)
        if old is not None and new and old != new:
            changes.append(f"{label}: {old} → {new}")

    if changes:
        log("[变化] 检测到以下变化，生成待审批任务并发邮件提醒：")
        for c in changes:
            log("  - " + c)
        # 仅在费率变化时：① 生成一条待审批 FBD 任务 ② 邮件通知相关人员
        push_fbd_task(cur, changes)
        content = (
            "FedEx 燃油附加费发生变化：\n\n"
            + "\n".join(changes)
            + f"\n\n当前生效周期(Ground): {cur['ground_effective']}"
            + f"\n来源: {URL}"
            + "\n\n请到 FBD 中心审批：待处理"
        )
        # 收件人＝本任务在面板上配置的 notify_emails
        try_notify("FedEx 燃油附加费变化提醒", content, recipients=task_recipients())
    elif not prev:
        log("[变化] 首次运行，已建立基线，本次不建任务、不发提醒。")
    else:
        log("[变化] 与上次相比无变化，不建任务、不发提醒。")

    cur["_checked_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    save_state(cur)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        log(f"[错误] 任务执行失败: {e}")
        sys.exit(1)
