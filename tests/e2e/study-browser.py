import json
import math
import os
import re
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
        if (window.fixtureVitals.lcp > 0) document.documentElement.dataset.fixtureLcp = 'ready';
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


def check_slow_navigation(page):
    pending = []
    target = '/wrong'
    pattern = f'**{target}?_rsc=*'

    def pause(route):
        pending.append(route)

    page.route(pattern, pause)
    tab = page.get_by_role('navigation', name='学习导航').locator(f'a[href="{target}"]')
    tab.tap()
    expect(tab.locator('.study-navigation-pending')).to_have_text('正在切换页面')
    expect(page.locator('.question-card .q-text')).to_be_visible()
    assert pending, 'The route payload must still be held when the navigation indicator appears.'
    for route in pending:
        route.continue_()
    page.unroute(pattern, pause)
    expect(page).to_have_url(ORIGIN + target)
    expect(tab).to_have_attribute('aria-current', 'page')
    expect(tab.locator('.study-navigation-pending')).to_have_count(0)

    page.get_by_role('link', name='打开友情赞助页面').click()
    expect(page.get_by_role('heading', name='友情赞助')).to_be_visible()
    tab.tap()
    expect(page).to_have_url(ORIGIN + target)
    expect(page.get_by_role('heading', name='友情赞助')).to_have_count(0)


def expect_field_error(page, name, error_id, text):
    field = page.locator(f'#auth-{name}')
    error = page.locator(f'#{error_id}')
    expect(error).to_have_text(text)
    expect(field).to_have_attribute('aria-invalid', 'true')
    assert error_id in field.get_attribute('aria-describedby').split()
    field_box, error_box = field.bounding_box(), error.bounding_box()
    assert field_box and error_box and error_box['y'] >= field_box['y'] + field_box['height']


def check_auth_fields(page):
    page.locator('#auth-email').fill('alice@example.test')
    password = page.locator('#auth-password')
    password.fill('incorrect-fixture-password')
    page.get_by_role('button', name='显示密码').click()
    expect(password).to_have_attribute('type', 'text')
    page.get_by_role('button', name='隐藏密码').click()
    expect(password).to_have_attribute('type', 'password')
    page.get_by_role('button', name='继续', exact=True).click()
    expect_field_error(page, 'password', 'auth-password-error', '密码错误，请重试。')

    page.get_by_role('button', name='注册', exact=True).click()
    expect(page.get_by_text('Hua Xiaowei — CQU', exact=True)).to_be_visible()
    page.locator('#auth-password').fill('local-fixture-only')
    register = page.get_by_role('button', name='注册并验证邮箱')
    register.click()
    expect_field_error(page, 'email', 'auth-email-error', '该邮箱已注册，请登录。')
    page.locator('#auth-email').fill('browser-signup@example.test')
    expect(page.locator('#auth-email-error')).to_have_count(0)
    register.click()

    code = page.locator('#auth-code')
    expect(code).to_be_visible()
    code.fill('123456')
    page.get_by_role('button', name='验证邮箱', exact=True).click()
    expect_field_error(page, 'code', 'auth-code-error', '验证码错误，请重试。')
    expect(page.get_by_text('Hua Xiaowei — CQU', exact=True)).to_be_visible()


def run(browser):
    for width in (390, 1440):
        context = browser.new_context(viewport={"width": width, "height": 900}, locale="zh-CN")
        page = context.new_page()
        page.goto(ORIGIN + "/login", wait_until="networkidle")
        assert page.get_by_role("heading", level=1).count() == 1
        assert page.get_by_role("heading", level=2).count() == 0
        assert page.get_by_text("登录", exact=True).count() == 0
        expect(page.get_by_text("第一次使用？", exact=True)).to_be_visible()
        expect(page.get_by_text("Hua Xiaowei — CQU", exact=True)).to_be_visible()
        wordmark = page.get_by_role("img", name="重庆大学")
        expect(wordmark).to_have_js_property("naturalWidth", 600)
        expect(page.locator('link[rel="icon"]')).to_have_attribute('href', '/cqu-crest.png')
        wordmark_box = wordmark.bounding_box()
        assert wordmark_box and wordmark_box["x"] < 48 and wordmark_box["y"] < 40
        expect(page.get_by_role("heading", level=1)).to_have_text("入党积极分子练习")
        primary = page.get_by_role("button", name="继续", exact=True).bounding_box()
        forgot = page.get_by_role("button", name="忘记密码").bounding_box()
        register = page.get_by_role("button", name="注册", exact=True).bounding_box()
        assert primary and forgot and register
        assert forgot["y"] > primary["y"] + primary["height"]
        assert abs(forgot["x"] - primary["x"]) <= 2
        assert abs(register["x"] + register["width"] - primary["x"] - primary["width"]) <= 2
        assert forgot["y"] == register["y"]
        for control in (page.locator('#auth-email'), page.locator('#auth-password'), page.get_by_role('button', name='继续')):
            expect(control).to_have_css('border-top-left-radius', '999px')
        page.locator('#auth-email').focus()
        expect(page.locator('#auth-email')).to_have_css('border-top-color', 'rgb(45, 93, 187)')
        expect(page.get_by_text('入党积极分子', exact=True)).to_have_css('font-family', re.compile(r'^"?SimHei'))
        if width == 390:
            check_auth_fields(page)
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
        expect(page.locator('.site-title img')).to_have_js_property('naturalWidth', 256)
        expect(page.get_by_text('作者：计算机学院 20230537 六只', exact=True)).to_be_visible()
        title_box, header_box = page.locator('.site-title').bounding_box(), page.locator('#site-header').bounding_box()
        assert title_box and header_box
        assert abs((title_box['x'] + title_box['width'] / 2) - (header_box['x'] + header_box['width'] / 2)) <= 2
        first_answerable.append(milliseconds(start))
        expect(page.locator('html')).to_have_attribute('data-fixture-lcp', 'ready')
        page.evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        vitals = page.evaluate('window.fixtureVitals')
        largest.append(vitals['lcp'])
        layout_shifts.append(vitals['cls'])
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        context.close()

    context = mobile_context(browser)
    page = context.new_page()
    page.on('dialog', lambda dialog: dialog.accept())
    with page.expect_response(lambda reply: reply.url.endswith('/api/public/questions?limit=20')) as warm_library:
        page.goto(ORIGIN, wait_until='domcontentloaded')
    assert warm_library.value.ok, 'The desktop and touch navigation should warm the first public library page.'
    stem = page.locator('.question-card .q-text')
    expect(stem).to_be_visible()
    expect(page.locator('.mode-btn[aria-pressed="true"]')).to_have_css('font-weight', '700')
    for inactive in page.locator('.mode-btn[aria-pressed="false"]').all():
        expect(inactive).to_have_css('font-weight', '400')
    switch_latency = []
    for _ in range(8):
        previous = stem.inner_text()
        start = perf_counter()
        page.get_by_role('button', name='下一题', exact=True).click()
        expect(stem).not_to_have_text(previous)
        switch_latency.append(milliseconds(start))

    practice_stem = stem.inner_text()
    correct = int(practice_stem.rsplit(' ', 1)[1]) % 4
    option = page.locator('.question-card .option')
    expect(page.locator('.stats-bar')).to_contain_text('已练习: 0')
    context.set_offline(True)
    page.get_by_role('button', name='展开解析').click()
    expect(page.locator('.explanation-panel')).to_contain_text('总解析测试')
    expect(page.locator('.answer-reveal')).to_have_text(f'正确答案：{"ABCD"[correct]}')
    expect(page.locator('.feedback')).to_have_count(0)
    expect(page.locator('.study-sync')).not_to_contain_text('待同步')
    page.get_by_role('button', name='收起解析').click()
    option.nth((correct + 1) % 4).click()
    expect(page.locator('.study-sync')).to_contain_text('本地已保存，待同步')
    expect(page.locator('.feedback')).to_have_text('✗ 错误')
    expect(option.nth(correct)).to_have_class('option correct')
    expect(page.get_by_role('button', name='确定', exact=True)).to_be_disabled()
    expect(page.locator('.explanation-panel')).to_contain_text('总解析测试')
    page.get_by_role('button', name='下一题', exact=True).click()
    expect(stem).not_to_have_text(practice_stem)
    expect(page.locator('.explanation-panel')).to_have_count(0)
    expect(page.locator('.feedback')).to_have_count(0)
    page.get_by_role('button', name='上一题', exact=True).click()
    expect(stem).to_have_text(practice_stem)
    expect(page.locator('.feedback')).to_have_text('✗ 错误')
    page.get_by_role('button', name='展开解析').click()
    expect(page.locator('.explanation-panel')).to_contain_text('总解析测试')

    pending_refresh = []

    def pause_stats(route):
        pending_refresh.append(route)

    page.route('**/api/me/stats', pause_stats)
    start = perf_counter()
    with page.expect_response(lambda reply: reply.url.endswith('/api/attempts/batch') and reply.request.method == 'POST') as sync_reply:
        context.set_offline(False)
    response = sync_reply.value
    assert response.ok, f'Attempt after reconnect returned {response.status}: {response.text()}'
    assert len(response.request.post_data_json['events']) == 1
    expect(page.locator('.study-sync')).to_contain_text('云端已同步', timeout=12_000)
    attempt_sync = milliseconds(start)
    expect(page.locator('.stats-bar')).to_contain_text('已练习: 0')
    assert pending_refresh, 'The test must check the previous stats during background refresh.'
    for route in pending_refresh:
        route.continue_()
    page.unroute('**/api/me/stats', pause_stats)
    expect(page.locator('.stats-bar')).to_contain_text('已练习: 1')

    check_slow_navigation(page)
    section(page, '/questions')
    search = page.get_by_role('searchbox', name='搜索题目')
    expect(search).to_be_visible()
    search_start = perf_counter()
    search.fill('分层练习样例 51')
    expect(page.locator('.list-item')).to_have_count(1)
    expect(page.locator('.list-item .q-text')).to_have_text('分层练习样例 51')
    browser_search = milliseconds(search_start)

    section(page, '/exam')
    count = page.get_by_role('spinbutton', name='题数')
    expect(count).to_have_value('50')
    start_exam = page.get_by_role('button', name='开始考试')
    count.fill('101')
    expect(start_exam).to_be_disabled()
    count.fill('8')
    expect(start_exam).to_be_enabled()
    start = perf_counter()
    start_exam.click()
    expect(page.locator('.exam-nav-item')).to_have_count(8)
    browser_exam_start = milliseconds(start)
    page.locator('.question-card .option').first.click()
    expect(page.locator('.exam-nav-item.current')).to_have_text('2')
    expect(page.get_by_text('草稿已云端同步')).to_be_visible()
    page.reload(wait_until='domcontentloaded')
    expect(page.locator('.exam-nav-item.current')).to_have_text('2')
    start = perf_counter()
    page.get_by_role('button', name='交卷', exact=True).click()
    expect(page.locator('.exam-result-item')).to_have_count(8)
    browser_exam_submit = milliseconds(start)
    expect(page.locator('.exam-score-total')).to_have_text('/ 8')
    page.get_by_role('button', name='返回', exact=True).click()
    page.get_by_role('button', name='历史记录').click()
    expect(page.locator('.exam-history-score')).to_contain_text('/8')

    section(page, '/')
    expect(stem).to_be_visible()
    page.get_by_role('link', name='打开友情赞助页面').click()
    expect(page.get_by_role('heading', name='友情赞助')).to_be_visible()
    section(page, '/')
    expect(stem).to_be_visible()
    expect(page.get_by_role('heading', name='友情赞助')).to_have_count(0)
    section(page, '/wrong')
    expect(page.locator('.stats-bar').filter(has_text='道错题')).to_be_visible()
    section(page, '/favorites')
    expect(page.locator('.stats-bar').filter(has_text='道收藏')).to_be_visible()
    page.get_by_role('link', name='账号', exact=True).click()
    expect(page).to_have_url(ORIGIN + '/account')
    expect(page.get_by_role('heading', name='账号')).to_be_visible()
    page.get_by_role('link', name='返回练习', exact=True).click()
    expect(stem).to_be_visible()
    cookies = context.cookies()
    context.close()

    desktop = browser.new_context(viewport={'width': 1280, 'height': 720})
    desktop.add_cookies(cookies)
    page = desktop.new_page()
    page.goto(ORIGIN + '/exam')
    expect(page.get_by_role('heading', name='模拟考试')).to_be_visible()
    nav = page.get_by_role('navigation', name='学习导航')
    before = nav.bounding_box()
    section(page, '/questions')
    expect(page.locator('.list-item')).to_have_count(20)
    assert page.evaluate('document.documentElement.scrollHeight > innerHeight')
    after = nav.bounding_box()
    assert before and after
    route_shift = max(abs(before[axis] - after[axis]) for axis in ('x', 'y'))
    assert route_shift <= 1, f'Navigation shifted {route_shift:.2f} px across short and tall pages'
    expect(page.locator('html')).to_have_css('scrollbar-gutter', 'stable both-edges')
    desktop.close()

    return {
        'browser': browser.version,
        'viewportCssPx': '390x844',
        'firstAnswerableMs': summarize(first_answerable),
        'lcpObservedMs': summarize(largest),
        'clsObserved': summarize(layout_shifts),
        'clickToQuestionChangedMs': summarize(switch_latency),
        'offlineAttemptReconnectToSyncedMs': round(attempt_sync, 2),
        'searchInputToFilteredResultMs': round(browser_search, 2),
        'startTo8ExamItemsMs': round(browser_exam_start, 2),
        'submitTo8ResultItemsMs': round(browser_exam_submit, 2),
        'desktopNavShiftPx': round(route_shift, 2),
    }


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, ignore_default_args=['--hide-scrollbars'])
    try:
        print('BROWSER_E2E ' + json.dumps(run(browser), ensure_ascii=False))
    finally:
        browser.close()
