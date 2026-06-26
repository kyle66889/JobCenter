#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FedEx Zone Chart 抓取任务
new Env('FedEx Zone Chart')
cron: 0 8 7 * *

从 https://www.fedex.com/ratetools/RateToolsMain.do 抓取指定 origin ZIP 的
美国国内 zone chart（PDF），保存到 /ql/data/zone_charts/，并与上月对比后发邮件汇报。

流程（纯标准库，无额外依赖）：
  1. GET  RateToolsMain.do          -> 取 cookies + 表单里的 session id
  2. POST RateToolsMain.do;SID      -> method=GetZoneLocators，解析 downloadFileName
  3. GET  /ratetools/<downloadFileName> -> 下载 PDF
"""
import hashlib
import json
import os
import re
import sys
from datetime import date, datetime
from http.cookiejar import CookieJar
from urllib.parse import urlencode
from urllib.request import build_opener, HTTPCookieProcessor, Request
from urllib.error import URLError, HTTPError

ORIGIN_ZIP = os.environ.get("FEDEX_ORIGIN_ZIP", "91789")

BASE = "https://www.fedex.com/ratetools"
MAIN_URL = f"{BASE}/RateToolsMain.do"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

SAVE_DIR = "/ql/data/zone_charts"
STATE_FILE = os.path.join(SAVE_DIR, ".zone_chart_state.json")

# 通知收件人取本任务（按 cron 名）在面板上配置的 notify_emails
DB_FILE = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "db", "database.sqlite")
)
TASK_NAME = "FedEx Zone Chart"

_opener = build_opener(HTTPCookieProcessor(CookieJar()))




def log(msg):
    print(msg, flush=True)


def _open(url, data=None, referer=None, timeout=30):
    headers = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/pdf,*/*",
        "Accept-Language": "en-US,en;q=0.9",
    }
    if referer:
        headers["Referer"] = referer
    if data is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        data = data.encode("utf-8")
    return _opener.open(Request(url, data=data, headers=headers), timeout=timeout)


def get_with_retry(url, data=None, referer=None, retries=3, binary=False):
    last = None
    for attempt in range(1, retries + 1):
        try:
            resp = _open(url, data=data, referer=referer)
            raw = resp.read()
            ctype = resp.headers.get("Content-Type", "")
            return raw if binary else raw.decode("utf-8", errors="ignore"), ctype
        except (URLError, HTTPError, OSError) as e:
            last = e
            log(f"[请求] {url} 第 {attempt}/{retries} 次失败: {e}")
    raise RuntimeError(f"请求失败: {url} -> {last}")


def extract_session_id(html):
    m = re.search(r'action="/ratetools/RateToolsMain\.do;([^"]+)"', html)
    return m.group(1) if m else ""


def extract_download_filename(html):
    m = re.search(r'name="downloadFileName"\s+value="([^"]+)"', html)
    return m.group(1) if m else ""


def fetch_zone_chart():
    # 1. 建会话
    html, _ = get_with_retry(MAIN_URL)
    sid = extract_session_id(html)
    if not sid:
        raise RuntimeError("未能从首页提取 session id（页面结构可能已变化）")

    # 2. 请求生成 zone chart，拿到 downloadFileName
    post_url = f"{MAIN_URL};{sid}"
    body = urlencode({
        "method": "GetZoneLocators",
        "zoneLocatorZipcode": ORIGIN_ZIP,
        "zoneLocatorFormat": "pdf",
        "downloadFileName": "",
        "zoneLocatorIncAllZips": "off",
    })
    step_html, _ = get_with_retry(post_url, data=body, referer=MAIN_URL)
    fname = extract_download_filename(step_html)
    if not fname:
        raise RuntimeError(f"未能解析 downloadFileName（ZIP={ORIGIN_ZIP} 可能无效或页面已变化）")
    log(f"[解析] downloadFileName = {fname}")

    # 3. 下载 PDF
    pdf_url = f"{BASE}/{fname}"
    pdf = get_with_retry(pdf_url, referer=f"{BASE}/DownloadRates.do", binary=True)
    if not isinstance(pdf, bytes):
        pdf = pdf[0]
    if not pdf.startswith(b"%PDF-"):
        raise RuntimeError(f"下载内容不是 PDF（前 16 字节: {pdf[:16]!r}）")
    return pdf, fname, pdf_url


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


def task_recipients():
    """读取本任务（cron 名 = TASK_NAME）在面板上配置的通知邮箱 notify_emails。"""
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


def try_notify(title, content, recipients=""):
    try:
        from notify import send, push_config

        # 收件人＝任务的 notify_emails；为空则回退 config.sh 的 SMTP_EMAIL_TO
        if recipients:
            push_config["SMTP_EMAIL_TO"] = recipients
        send(title, content)
    except Exception as e:  # noqa: BLE001  通知失败不影响任务结果
        log(f"[通知] 发送失败（不影响下载结果）: {e}")


def main():
    os.makedirs(SAVE_DIR, exist_ok=True)
    pdf, source_name, pdf_url = fetch_zone_chart()

    today = date.today().isoformat()
    out_name = f"zone_{ORIGIN_ZIP}_{today}.pdf"
    out_path = os.path.join(SAVE_DIR, out_name)
    with open(out_path, "wb") as f:
        f.write(pdf)

    size_kb = round(len(pdf) / 1024, 1)
    md5 = hashlib.md5(pdf).hexdigest()
    prev = load_state()
    prev_md5 = prev.get("md5")
    if prev_md5 is None:
        change_note = "首次下载，已建立基线。"
    elif prev_md5 == md5:
        change_note = "与上次内容相同（未变化）。"
    else:
        change_note = "⚠️ 与上次内容不同（zone chart 已更新）。"

    log("=" * 48)
    log("FedEx Zone Chart 下载完成")
    log(f"  Origin ZIP : {ORIGIN_ZIP}")
    log(f"  来源文件   : {source_name}")
    log(f"  保存到     : {out_path}")
    log(f"  大小       : {size_kb} KB")
    log(f"  MD5        : {md5}")
    log(f"  对比       : {change_note}")
    log("=" * 48)

    # 仅在内容变化（md5 与上次不同）时才发邮件；首次/无变化只记日志不发。
    changed = prev_md5 is not None and prev_md5 != md5
    if changed:
        content = (
            f"FedEx Zone Chart 已更新\n\n"
            f"Origin ZIP: {ORIGIN_ZIP}\n"
            f"文件: {out_name}\n"
            f"大小: {size_kb} KB\n"
            f"对比: {change_note}\n"
            f"保存路径: {out_path}\n"
            f"来源: {pdf_url}"
        )
        try_notify("FedEx Zone Chart 已更新", content, recipients=task_recipients())
    elif prev_md5 is None:
        log("[变化] 首次下载，已建立基线，本次不发提醒。")
    else:
        log("[变化] 与上次内容相同，不发提醒。")

    save_state({
        "md5": md5,
        "source_name": source_name,
        "file": out_name,
        "size_kb": size_kb,
        "_checked_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    })


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        log(f"[错误] 任务执行失败: {e}")
        try_notify("FedEx Zone Chart 抓取失败", f"任务执行失败:\n{e}", recipients=task_recipients())
        sys.exit(1)
