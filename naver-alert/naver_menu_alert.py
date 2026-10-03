"""네이버 예약 페이지에서 특정 메뉴가 활성화(품절 해제)되면 폰으로 알림만 보내는 스크립트.

설치:
    pip install playwright requests
    playwright install chromium

실행:
    python naver_menu_alert.py --test-push        # 알림이 오는지 먼저 확인
    python naver_menu_alert.py --dump             # 페이지 텍스트/스크린샷 저장 (선택자 점검용)
    python naver_menu_alert.py                    # 감시 시작

알림: 폰에 ntfy 앱을 설치하고 NTFY_TOPIC 과 같은 이름의 토픽을 구독하세요 (계정 불필요).
    export NTFY_TOPIC=내만의-긴-랜덤-문자열
주문/결제는 하지 않습니다. 알림 받고 직접 들어가서 주문하세요.
"""
import argparse
import os
import random
import re
import time
from datetime import datetime

import requests
from playwright.sync_api import sync_playwright

URL = (
    "https://m.booking.naver.com/booking/6/bizes/1423191/items/6890689"
    "?area=ple&theme=place&gbwState=%7B%22entryMode%22%3A%22productSelected%22%2C%22step%22%3A2%2C"
    "%22selection%22%3A%7B%22people%22%3A1%2C%22dateTime%22%3A%222026-10-03T20%3A30%3A00%22%2C"
    "%22products%22%3A%5B%7B%22product%22%3A%7B%22id%22%3A%226890689%22%2C%22title%22%3A%22"
    "%ED%8F%AC%EC%9E%A5+%EC%98%88%EC%95%BD%22%2C%22category%22%3A%22takeout%22%7D%2C%22count%22%3A1"
    "%7D%5D%2C%22slotId%22%3A%221366296577%22%2C%22scheduleId%22%3A%221349830667%22%7D%7D"
)
KEYWORDS = ["모듬회", "중방어"]
SOLD_OUT = re.compile(r"품절|마감|매진|sold\s*out|예약\s*불가|준비\s*중|선택\s*불가", re.I)
INTERVAL = (25, 40)  # 초 단위 랜덤 간격. 너무 짧게 하지 마세요.
RENOTIFY_SEC = 300   # 같은 메뉴 재알림 최소 간격

# 메뉴명 요소에서 위로 올라가며 가격("원")이 포함된 가장 가까운 행을 찾아 상태를 읽는다.
ROW_JS = """
(el) => {
  let n = el;
  for (let i = 0; i < 6 && n.parentElement; i++) {
    n = n.parentElement;
    if (/원/.test(n.innerText || '')) break;
  }
  const bad = '[disabled],[aria-disabled="true"]';
  return {
    text: (n.innerText || '').trim(),
    disabled: n.matches(bad) || !!n.querySelector(bad)
              || /disabled|soldout|sold-out/i.test(n.className || ''),
  };
}
"""


def push(msg: str) -> None:
    print(f"[{datetime.now():%H:%M:%S}] ALERT: {msg}", flush=True)
    topic = os.environ.get("NTFY_TOPIC")
    if not topic:
        print("  (NTFY_TOPIC 미설정: 콘솔에만 표시)")
        return
    requests.post(
        f"https://ntfy.sh/{topic}",
        data=msg.encode("utf-8"),
        headers={"Priority": "urgent", "Click": URL},
        timeout=10,
    )


def check(page) -> dict:
    page.goto(URL, wait_until="networkidle", timeout=45000)
    time.sleep(2)
    result = {}
    for kw in KEYWORDS:
        loc = page.get_by_text(kw, exact=False)
        if loc.count() == 0:
            result[kw] = ("없음", "")
            continue
        row = loc.first.evaluate(ROW_JS)
        sold = row["disabled"] or bool(SOLD_OUT.search(row["text"]))
        result[kw] = ("품절" if sold else "활성", row["text"].replace("\n", " | "))
    return result


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--test-push", action="store_true")
    ap.add_argument("--dump", action="store_true")
    ap.add_argument("--headed", action="store_true", help="브라우저 창 보이기")
    args = ap.parse_args()

    if args.test_push:
        push("테스트 알림입니다. 이게 폰에 오면 설정 완료!")
        return

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headed)
        ctx = browser.new_context(**p.devices["iPhone 13"], locale="ko-KR")
        page = ctx.new_page()

        if args.dump:
            page.goto(URL, wait_until="networkidle", timeout=45000)
            time.sleep(2)
            page.screenshot(path="dump.png", full_page=True)
            open("dump.txt", "w", encoding="utf-8").write(page.inner_text("body"))
            print("dump.png / dump.txt 저장 완료")
            browser.close()
            return

        last_alert: dict[str, float] = {}
        print(f"감시 시작: {KEYWORDS} (Ctrl+C 로 종료)")
        while True:
            try:
                res = check(page)
                print(f"[{datetime.now():%H:%M:%S}]", {k: v[0] for k, v in res.items()}, flush=True)
                for kw, (state, detail) in res.items():
                    if state == "활성" and time.time() - last_alert.get(kw, 0) > RENOTIFY_SEC:
                        push(f"{kw} 활성화됨! 지금 주문하세요. ({detail[:60]})")
                        last_alert[kw] = time.time()
            except Exception as e:  # 네트워크/페이지 오류는 무시하고 계속
                print(f"[{datetime.now():%H:%M:%S}] 오류: {e}", flush=True)
            time.sleep(random.uniform(*INTERVAL))


if __name__ == "__main__":
    main()
