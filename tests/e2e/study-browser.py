import json
import math
import os
from time import perf_counter
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright


ORIGIN = os.environ['EQB_TEST_ORIGIN']
COOKIE_NAME = os.environ['EQB_TEST_COOKIE_NAME']
COOKIE_TOKEN = os.environ['EQB_TEST_COOKIE_TOKEN']
HOST = urlsplit(ORIGIN).hostname
assert HOST in ('127.0.0.1', 'localhost'), 'This browser fixture uses synthetic loopback accounts.'


def milliseconds(start):
    return (perf_counter() - start) * 1_000


def summarize(samples):
    samples = sorted(samples)
    return {key: round(samples[math.ceil(len(samples) * fraction) - 1], 2)
            for key, fraction in [('p50', .50), ('p75', .75), ('p95', .95)]} | {'n': len(samples)}


def mobile_context(browser):
    context = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True,
                                  has_touch=True, device_scale_factor=1, locale='zh-CN')
    context.add_cookies([{
        'name': COOKIE_NAME, 'value': COOKIE_TOKEN, 'domain': HOST, 'path': '/',
        'secure': True, 'httpOnly': True, 'sameSite': 'Strict',
    }])
    context.add_init_script('''
      window.fixtureVitals = { lcp: 0, cls: 0 };
      let windowStart = 0;
      let windowEnd = 0;
      let windowValue = 0;
      new PerformanceObserver((entries) => {
        for (const entry of entries.getEntries()) {
          window.fixtureVitals.lcp = Math.max(window.fixtureVitals.lcp, entry.startTime);
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver((entries) => {
        for (const entry of entries.getEntries()) {
          if (entry.hadRecentInput) continue;
          if (windowValue === 0 || entry.startTime - windowEnd >= 1000 || entry.startTime - windowStart >= 5000) {
            windowStart = entry.startTime;
            windowValue = 0;
          }
          windowValue += entry.value;
          windowEnd = entry.startTime;
          window.fixtureVitals.cls = Math.max(window.fixtureVitals.cls, windowValue);
        }
      }).observe({ type: 'layout-shift', buffered: true });
    ''')
    return context


def section(page, route):
    page.get_by_role('navigation', name='学习导航').locator(f'a[href="{route}"]').click()
    expect(page).to_have_url(ORIGIN + route)


def run(browser):
    for width in (390, 1440):
        context = browser.new_context(viewport={"width": width, "height": 900}, locale="zh-CN")
        page = context.new_page()
        page.goto(ORIGIN + "/login", wait_until="networkidle")
        assert page.get_by_role("heading", level=1).count() == 1
        assert page.get_by_role("heading", level=2).count() == 0
        assert page.get_by_text("登录", exact=True).count() == 0
        assert page.get_by_text("第一次使用", exact=False).count() == 0
        primary = page.get_by_role("button", name="继续", exact=True).bounding_box()
        forgot = page.get_by_role("button", name="忘记密码").bounding_box()
        register = page.get_by_role("button", name="创建账号").bounding_box()
        assert primary and forgot and register
        assert forgot["y"] > primary["y"] + primary["height"]
        assert abs(forgot["x"] - primary["x"]) <= 2
        assert abs(register["x"] + register["width"] - primary["x"] - primary["width"]) <= 2
        assert forgot["y"] == register["y"]
        context.close()

    first_answerable = []
    largest = []
    layout_shifts = []
    for _ in range(6):
        context = mobile_context(browser)
        page = context.new_page()
        start = perf_counter()
        page.goto(ORIGIN, wait_until='domcontentloaded')
        expect(page.locator('.question-card .option').first).to_be_enabled()
        expect(page.locator('.question-card .q-text')).to_contain_text('分层练习样例')
        first_answerable.append(milliseconds(start))
        page.wait_for_function('window.fixtureVitals.lcp > 0')
        page.evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        vitals = page.evaluate('window.fixtureVitals')
        largest.append(vitals['lcp'])
        layout_shifts.append(vitals['cls'])
        assert page.evaluate('document.documentElement.scrollWidth === innerWidth')
        context.close()

    context = mobile_context(browser)
    page = context.new_page()
    page.on('dialog', lambda dialog: dialog.accept())
    page.goto(ORIGIN, wait_until='domcontentloaded')
    stem = page.locator('.question-card .q-text')
    expect(stem).to_be_visible()
    switch_latency = []
    for _ in range(8):
        previous = stem.inner_text()
        start = perf_counter()
        page.get_by_role('button', name='下一题', exact=True).click()
        expect(stem).not_to_have_text(previous)
        switch_latency.append(milliseconds(start))

    context.set_offline(True)
    page.locator('.question-card .option').first.click()
    page.get_by_role('button', name='确定', exact=True).click()
    expect(page.locator('.study-sync')).to_contain_text('本地已保存，待同步')
    expect(page.locator('.feedback')).to_be_visible()
    page.get_by_role('button', name='展开解析').click()
    expect(page.locator('.explanation-panel')).to_contain_text('总解析测试')
    start = perf_counter()
    with page.expect_response(lambda reply: reply.url.endswith('/api/attempts/batch') and reply.request.method == 'POST') as sync_reply:
        context.set_offline(False)
    response = sync_reply.value
    assert response.ok, f'Attempt after reconnect returned {response.status}: {response.text()}'
    expect(page.locator('.study-sync')).to_contain_text('云端已同步', timeout=12_000)
    attempt_sync = milliseconds(start)
    expect(page.locator('.stats-bar')).to_contain_text('已练习: 1')

    section(page, '/questions')
    search = page.get_by_role('searchbox', name='搜索题目')
    expect(search).to_be_visible()
    search_start = perf_counter()
    search.fill('分层练习样例 51')
    expect(page.locator('.list-item')).to_have_count(1)
    expect(page.locator('.list-item .q-text')).to_have_text('分层练习样例 51')
    browser_search = milliseconds(search_start)

    section(page, '/exam')
    start = perf_counter()
    page.get_by_role('button', name='开始考试').click()
    expect(page.locator('.exam-nav-item')).to_have_count(50)
    browser_exam_start = milliseconds(start)
    page.locator('.question-card .option').first.click()
    expect(page.locator('.exam-nav-item.current')).to_have_text('2')
    expect(page.get_by_text('草稿已云端同步')).to_be_visible()
    page.reload(wait_until='domcontentloaded')
    expect(page.locator('.exam-nav-item.current')).to_have_text('2')
    start = perf_counter()
    page.get_by_role('button', name='交卷', exact=True).click()
    expect(page.locator('.exam-result-item')).to_have_count(50)
    browser_exam_submit = milliseconds(start)
    context.close()

    return {
        'browser': browser.version,
        'viewportCssPx': '390x844',
        'firstAnswerableMs': summarize(first_answerable),
        'lcpObservedMs': summarize(largest),
        'clsObserved': summarize(layout_shifts),
        'clickToQuestionChangedMs': summarize(switch_latency),
        'offlineAttemptReconnectToSyncedMs': round(attempt_sync, 2),
        'searchInputToFilteredResultMs': round(browser_search, 2),
        'startTo50ExamItemsMs': round(browser_exam_start, 2),
        'submitTo50ResultItemsMs': round(browser_exam_submit, 2),
    }


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    try:
        print('BROWSER_E2E ' + json.dumps(run(browser), ensure_ascii=False))
    finally:
        browser.close()
