import json
import math
import os
import re
from time import perf_counter
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import expect, sync_playwright


ORIGIN = os.environ['EQB_TEST_ORIGIN']
COOKIE_NAME = os.environ['EQB_TEST_COOKIE_NAME']
COOKIE_TOKEN = os.environ['EQB_TEST_COOKIE_TOKEN']
MULTIPLE_POSITION = os.environ['EQB_TEST_MULTIPLE_POSITION']
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
    page.goto(ORIGIN, wait_until='domcontentloaded')
    expect(page.locator('.question-card .q-text')).to_be_visible()
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
    page.get_by_role('button', name='重新发送验证码', exact=True).click()
    expect(page.get_by_role('status').filter(has_text='请查收邮件')).to_be_visible()
    code.fill('732518')
    page.get_by_role('button', name='验证邮箱', exact=True).click()
    expect(page).to_have_url(ORIGIN + '/')

    page.get_by_role('link', name='账号', exact=True).click()
    page.get_by_role('button', name='退出登录', exact=True).click()
    expect(page).to_have_url(ORIGIN + '/login')
    page.get_by_role('button', name='忘记密码', exact=True).click()
    page.locator('#auth-email').fill('browser-signup@example.test')
    page.get_by_role('button', name='发送重置验证码', exact=True).click()
    expect(page.get_by_role('heading', name='重置密码')).to_be_visible()
    page.locator('#auth-code').fill('628154')
    page.locator('#auth-password').fill('changed-fixture-only')
    page.get_by_role('button', name='保存新密码', exact=True).click()
    expect(page.get_by_role('status').filter(has_text='密码已更新')).to_be_visible()

    page.locator('#auth-password').fill('local-fixture-only')
    page.get_by_role('button', name='继续', exact=True).click()
    expect_field_error(page, 'password', 'auth-password-error', '密码错误，请重试。')
    page.locator('#auth-password').fill('changed-fixture-only')
    page.get_by_role('button', name='继续', exact=True).click()
    expect(page).to_have_url(ORIGIN + '/')


def check_auth_autofill(page):
    cdp = page.context.new_cdp_session(page)
    cdp.send('DOM.enable')
    cdp.send('CSS.enable')
    root = cdp.send('DOM.getDocument')['root']['nodeId']
    for selector in ('#auth-email', '#auth-password'):
        node = cdp.send('DOM.querySelector', {'nodeId': root, 'selector': selector})['nodeId']
        cdp.send('CSS.forcePseudoState', {'nodeId': node, 'forcedPseudoClasses': ['autofill']})
        expect(page.locator(selector)).to_have_css('box-shadow', re.compile(r'rgb\(253, 252, 251\).*inset'))
        cdp.send('CSS.forcePseudoState', {'nodeId': node, 'forcedPseudoClasses': []})
    eye = page.get_by_role('button', name='显示密码')
    eye.hover()
    expect(eye).to_have_css('background-color', 'rgba(0, 0, 0, 0)')
    cdp.detach()


def check_library_pages(page):
    pagination = page.get_by_role('navigation', name='题库分页')
    position = pagination.get_by_label('当前页 / 总页数')
    next_button = pagination.get_by_role('button', name='下一页')
    rows = page.locator('.list-item')
    expect(position).to_have_text('1/3')
    expect(page.get_by_text('51 道符合条件的题目')).to_be_visible()
    expect(rows).to_have_count(20)
    first_stem = rows.first.locator('.q-text').inner_text()
    initial_color = next_button.evaluate('(element) => getComputedStyle(element).backgroundColor')
    paused = []
    pattern = '**/api/public/questions?offset=20&limit=20'

    def pause(route):
        paused.append(route)

    page.route(pattern, pause)
    next_button.tap()
    expect(pagination.get_by_role('status').filter(has_text='正在加载')).to_have_text('正在加载第 2 页…')
    expect(next_button).to_be_enabled()
    expect(next_button).to_have_css('background-color', initial_color)
    expect(next_button).to_have_css('opacity', '1')
    expect(rows.first.locator('.q-text')).to_have_text(first_stem)
    assert paused
    for route in paused:
        route.continue_()
    page.unroute(pattern, pause)
    expect(position).to_have_text('2/3')
    expect(next_button).to_have_css('background-color', initial_color)
    expect(next_button).to_be_enabled()
    next_button.tap()
    expect(position).to_have_text('3/3')
    expect(rows).to_have_count(11)
    expect(next_button).to_be_disabled()
    pagination.get_by_role('combobox', name='每页题量').select_option('30')
    expect(position).to_have_text('1/2')
    expect(rows).to_have_count(30)
    expect(next_button).to_be_enabled()


def check_exam_result_header(page):
    header = page.locator('.exam-result-top')
    back = header.get_by_role('button', name='← 返回', exact=True)
    replay = header.get_by_role('button', name='原卷重新考试', exact=True)
    expect(back).to_be_visible()
    expect(replay).to_be_enabled()
    back_box, replay_box = back.bounding_box(), replay.bounding_box()
    assert back_box and replay_box
    assert back_box['x'] + back_box['width'] <= replay_box['x']
    assert abs((back_box['y'] + back_box['height'] / 2) - (replay_box['y'] + replay_box['height'] / 2)) <= 1
    return replay


def check_exam_history_header(page):
    header = page.locator('.exam-history-header')
    title = header.get_by_role('heading', name='考试历史', exact=True)
    back = header.get_by_role('button', name='← 返回', exact=True)
    expect(title).to_be_visible()
    expect(back).to_be_visible()
    title_box, back_box = title.bounding_box(), back.bounding_box()
    assert title_box and back_box
    assert back_box['x'] + back_box['width'] <= title_box['x']
    assert abs(title_box['x'] + title_box['width'] / 2 - page.evaluate('innerWidth / 2')) <= 1


def check_feedback(page):
    footer = page.get_by_role('contentinfo')
    feedback_link = footer.get_by_role('link', name='打开意见反馈页面')
    sponsor_link = footer.get_by_role('link', name='打开友情赞助页面')
    notes = footer.locator('.footer-notes')
    left, middle, right, frame = (item.bounding_box() for item in (feedback_link, notes, sponsor_link, footer))
    assert left and middle and right and frame
    assert left['x'] + left['width'] < middle['x'] < right['x']
    assert abs((left['x'] + right['x'] + right['width']) / 2 - (frame['x'] + frame['width'] / 2)) <= 1

    feedback_link.click()
    expect(page).to_have_url(ORIGIN + '/#feedback')
    heading = page.get_by_role('heading', name='意见反馈')
    expect(heading).to_be_focused()
    expect(page.locator('.question-card')).to_be_hidden()
    form = page.get_by_role('region', name='意见反馈')
    ratings = form.get_by_role('radio')
    expect(ratings).to_have_count(5)
    assert [radio.get_attribute('value') for radio in ratings.all()] == ['夯', '顶级', '人上人', 'NPC', '拉完了']
    message = form.get_by_role('textbox', name='你希望我们改进什么？')
    submit = form.get_by_role('button', name='提交反馈')
    submit.click()
    assert not form.locator('form').evaluate('(form) => form.checkValidity()')
    form.get_by_role('radio', name='NPC').check()
    page.keyboard.press('ArrowRight')
    lowest = form.get_by_role('radio', name='拉完了')
    expect(lowest).to_be_checked()
    message.fill('   ')
    submit.click()
    expect(form.get_by_role('alert')).to_contain_text('填写你的意见或建议')

    feedback_api = ORIGIN + '/api/feedback'
    body = '希望增加模考历史筛选。'
    message.fill(body)
    with page.expect_response(feedback_api) as request:
        submit.click()
    assert request.value.status == 503
    assert request.value.request.post_data_json == {'rating': '拉完了', 'message': body}
    expect(form.get_by_role('alert')).to_contain_text('暂时无法提交反馈')
    expect(message).to_have_value(body)
    expect(lowest).to_be_checked()

    page.route(feedback_api, lambda route: route.fulfill(json={'sent': True}))
    submit.click()
    expect(form.get_by_role('status')).to_have_text('反馈已提交，感谢你的建议！')
    expect(message).to_have_count(0)
    page.unroute(feedback_api)
    page.get_by_role('link', name='← 返回练习').click()
    expect(page).to_have_url(ORIGIN + '/')
    expect(page.locator('.question-card')).to_be_visible()


def run(browser):
    for width in (390, 1440):
        context = browser.new_context(viewport={"width": width, "height": 900}, locale="zh-CN")
        page = context.new_page()
        page.goto(ORIGIN + "/login", wait_until="networkidle")
        assert page.get_by_role("heading", level=1).count() == 1
        assert page.get_by_role("heading", level=2).count() == 0
        assert page.get_by_text("登录", exact=True).count() == 0
        expect(page.get_by_text("第一次使用？", exact=True)).to_be_visible()
        credit = page.get_by_text("Hua Xiaowei — CQU", exact=True)
        expect(credit).to_be_visible()
        expect(credit).to_have_css("font-family", re.compile(r'^"Times New Roman"'))
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
        else:
            check_auth_autofill(page)
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
        expect(page.locator('.site-title img')).to_have_css('width', '32px')
        footer_lines = page.locator('.footer-notes li')
        expect(footer_lines).to_have_text(['Bug 或瑕疵有奖', '作者：计算机学院 20230537 六只', '遇到问题请联系 QQ 1176843521'])
        expect(page.locator('.footer-latin').first).to_have_css('font-family', re.compile(r'^"Times New Roman"'))
        title_box, header_box = page.locator('.site-title-name').bounding_box(), page.locator('#site-header').bounding_box()
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

    slow_context = mobile_context(browser)
    check_slow_navigation(slow_context.new_page())
    slow_context.close()

    context = mobile_context(browser)
    page = context.new_page()
    page.on('dialog', lambda dialog: dialog.accept())
    state_reads, favorite_writes = [], []

    def track_practice_request(request):
        url = urlsplit(request.url)
        if url.path == '/api/me/question-state':
            state_reads.append(parse_qs(url.query)['ids'][0].split(','))
        elif url.path.startswith('/api/me/favorites/') and request.method == 'PUT':
            favorite_writes.append(request)

    state_pattern = '**/api/me/question-state?*'
    page.on('request', track_practice_request)
    page.route(state_pattern, lambda route: route.abort(), times=1)
    with page.expect_response(lambda reply: reply.url.endswith('/api/public/questions?limit=20')) as warm_library:
        page.goto(ORIGIN, wait_until='domcontentloaded')
    assert warm_library.value.ok, 'The desktop and touch navigation should warm the first public library page.'
    stem = page.locator('.question-card .q-text')
    expect(stem).to_be_visible()
    expect(page.locator('.mode-btn[aria-pressed="true"]')).to_have_css('font-weight', '700')
    for inactive in page.locator('.mode-btn[aria-pressed="false"]').all():
        expect(inactive).to_have_css('font-weight', '400')
    favorite_button = page.locator('.question-card .action-bar').get_by_role('button', name='☆ 收藏', exact=True)
    expect(favorite_button).to_be_enabled()
    expect(favorite_button).to_have_attribute('aria-pressed', 'false')
    active_batch = state_reads[0]
    assert len(active_batch) == 15

    def from_active_batch(response):
        url = urlsplit(response.url)
        return url.path == '/api/me/question-state' and parse_qs(url.query)['ids'][0].split(',') == active_batch

    held_write = []
    favorite_pattern = '**/api/me/favorites/*'
    page.route(favorite_pattern, lambda route: held_write.append(route), times=1)
    favorite_button.tap()
    remove_favorite = page.locator('.question-card .action-bar').get_by_role('button', name='★ 取消收藏', exact=True)
    expect(remove_favorite).to_have_attribute('aria-pressed', 'true')
    expect(remove_favorite).to_have_attribute('aria-busy', 'true')
    assert held_write and len(favorite_writes) == 1, 'The label must change before the first save responds.'
    assert all(len(ids) != 1 for ids in state_reads), 'Adding a displayed unstarred question must not await a preliminary read.'
    remove_favorite.tap()
    expect(favorite_button).to_have_attribute('aria-pressed', 'false')
    expect(favorite_button).to_have_attribute('aria-busy', 'true')
    assert len(favorite_writes) == 1, 'A second click must not send a concurrent write for the same question.'
    with page.expect_response(from_active_batch):
        held_write[0].continue_()
    expect(favorite_button).not_to_have_attribute('aria-busy', 'true')
    assert [request.post_data_json['favorite'] for request in favorite_writes] == [True, False]

    held_failure = []
    page.route(favorite_pattern, lambda route: held_failure.append(route), times=1)
    favorite_button.tap()
    expect(remove_favorite).to_have_attribute('aria-pressed', 'true')
    assert held_failure
    held_failure[0].fulfill(status=503, json={'error': '收藏未保存，请重试。'})
    expect(favorite_button).to_have_attribute('aria-pressed', 'false')
    expect(page.get_by_role('alert').filter(has_text='收藏未保存')).to_be_visible()
    expect(favorite_button).not_to_have_attribute('aria-busy', 'true')
    state_reads_before_switching = len(state_reads)
    switch_latency = []
    for _ in range(8):
        previous = stem.inner_text()
        start = perf_counter()
        page.get_by_role('button', name='下一题', exact=True).click()
        expect(stem).not_to_have_text(previous)
        switch_latency.append(milliseconds(start))
        expect(favorite_button).to_have_attribute('aria-pressed', 'false')
    reads_during_switch = state_reads[state_reads_before_switching:]
    assert all(len(ids) > 1 for ids in reads_during_switch)
    assert reads_during_switch.count(active_batch) <= 1, 'Only the background refresh may reread the current batch.'

    practice_stem = stem.inner_text()
    correct = int(practice_stem.rsplit(' ', 1)[1]) % 4
    option = page.locator('.question-card .option')
    expect(page.locator('.stats-bar')).to_contain_text('已练习: 0')
    context.set_offline(True)
    favorite_button.click()
    expect(page.get_by_text('离线时无法更新收藏，请联网后重试。')).to_be_visible()
    assert len(favorite_writes) == 3
    explanation = page.get_by_role('button', name='展开解析')
    background = explanation.evaluate('(element) => getComputedStyle(element).backgroundColor')
    explanation.tap()
    expect(page.get_by_role('button', name='收起解析')).to_have_css('background-color', background)
    expect(page.locator('.explanation-panel')).to_contain_text('总解析测试')
    expect(page.locator('.answer-reveal')).to_have_text(f'正确答案：{"ABCD"[correct]}')
    expect(page.locator('.feedback')).to_have_count(0)
    expect(page.locator('.study-sync')).not_to_contain_text('待同步')
    page.get_by_role('button', name='收起解析').tap()
    expect(explanation).to_have_css('background-color', background)
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

    section(page, '/questions')
    expect(page.get_by_role('searchbox', name='搜索题目')).to_be_visible()
    section(page, '/')
    expect(stem).to_have_text(practice_stem)
    expect(page.locator('.question-card .done-badge')).to_have_text('✓ 已答')

    modes = page.get_by_role('group', name='练习模式')
    mode_positions = '(buttons) => buttons.map((button) => { const { x, width } = button.getBoundingClientRect(); return [x, width] })'
    positions = modes.locator('button').evaluate_all(mode_positions)
    for label in ('随机', '顺序', '错题', '收藏', '专题'):
        mode = modes.get_by_role('button', name=label, exact=True)
        mode.click()
        expect(mode).to_have_attribute('aria-pressed', 'true')
        assert modes.locator('button').evaluate_all(mode_positions) == positions
    expect(stem).to_have_text(practice_stem)

    modes.get_by_role('button', name='顺序', exact=True).click()
    page.get_by_role('button', name='跳转', exact=True).click()
    page.get_by_role('spinbutton', name='题号').fill(MULTIPLE_POSITION)
    page.get_by_role('button', name='前往', exact=True).click()
    expect(stem).to_have_text('分层练习样例 50')
    expect(page.locator('.q-type')).to_have_text('多选题')
    option.nth(0).tap()
    expect(page.locator('.feedback')).to_have_count(0)
    expect(page.locator('.explanation-panel')).to_have_count(0)
    page.get_by_role('button', name='确定', exact=True).tap()
    expect(page.locator('.feedback')).to_have_text('✗ 错误')
    expect(page.locator('.explanation-panel')).to_contain_text('总解析测试')

    def preference_write(response):
        return response.url.endswith('/api/me/preferences') and response.request.method == 'PUT' and response.ok

    modes.get_by_role('button', name='专题', exact=True).tap()
    page.locator('.topic-dropdown-btn').tap()
    page.get_by_role('button', name='党的二十届四中全会精神', exact=True).tap()
    expect(page.locator('.topic-dropdown-btn')).to_have_text('党的二十届四中全会精神')
    modes.get_by_role('button', name='顺序', exact=True).tap()
    expect(stem).to_have_text('分层练习样例 50')

    if page.locator('html').get_attribute('data-theme') != 'dark':
        with page.expect_response(lambda response: preference_write(response) and response.request.post_data_json.get('theme') == 'dark'):
            page.get_by_role('button', name='切换明暗主题').tap()

    section(page, '/questions')
    check_library_pages(page)
    search = page.get_by_role('searchbox', name='搜索题目')
    expect(search).to_be_visible()
    search_start = perf_counter()
    # The cache-invalidation test withdraws a random t01 item. Use a t14 fixture here.
    search_stem = '分层练习样例 48'
    search.fill(search_stem)
    expect(page.locator('.list-item')).to_have_count(1)
    expect(page.locator('.list-item .q-text')).to_have_text(search_stem)
    browser_search = milliseconds(search_start)
    search.fill('选项文本 2')
    page.locator('.topic-dropdown-btn').tap()
    page.get_by_role('button', name='党的二十届四中全会精神', exact=True).tap()
    page.get_by_role('group', name='按题型筛选').get_by_role('button', name='单选', exact=True).tap()
    with page.expect_response(lambda response: preference_write(response) and
                              response.request.post_data_json.get('library:all', {}).get('status') == 'undone'):
        page.get_by_role('group', name='按作答状态筛选').get_by_role('button', name='未做', exact=True).tap()
    expect(page.get_by_text(re.compile(r'\d+ 道符合条件的题目'))).to_be_visible()

    device = mobile_context(browser)
    elsewhere = device.new_page()
    elsewhere.goto(ORIGIN + '/questions')
    expect(elsewhere.locator('html')).to_have_attribute('data-theme', 'dark')
    expect(elsewhere.get_by_role('searchbox', name='搜索题目')).to_have_value('选项文本 2')
    expect(elsewhere.locator('.topic-dropdown-btn')).to_have_text('党的二十届四中全会精神')
    expect(elsewhere.get_by_role('group', name='按题型筛选').get_by_role('button', name='单选', exact=True)).to_have_attribute('aria-pressed', 'true')
    expect(elsewhere.get_by_role('group', name='按作答状态筛选').get_by_role('button', name='未做', exact=True)).to_have_attribute('aria-pressed', 'true')
    expect(elsewhere.get_by_role('combobox', name='每页题量')).to_have_value('30')
    section(elsewhere, '/')
    expect(elsewhere.get_by_role('group', name='练习模式').get_by_role('button', name='顺序', exact=True)).to_have_attribute('aria-pressed', 'true')
    expect(elsewhere.locator('.question-card .q-text')).to_have_text('分层练习样例 50')
    elsewhere.get_by_role('group', name='练习模式').get_by_role('button', name='专题', exact=True).tap()
    expect(elsewhere.locator('.topic-dropdown-btn')).to_have_text('党的二十届四中全会精神')
    device.close()

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
    wrong_exam_stem = page.locator('.exam-question-card .q-text').inner_text()
    wrong_option = (int(wrong_exam_stem.rsplit(' ', 1)[1]) + 1) % 4
    first_is_multiple = page.locator('.question-card .q-type').inner_text() == '多选题'
    page.locator('.question-card .option').nth(wrong_option).click()
    if first_is_multiple:
        page.get_by_role('button', name='下一题', exact=True).tap()
    expect(page.locator('.exam-nav-item.current')).to_have_text('2')
    mark = page.get_by_role('button', name='标记', exact=True)
    marked = page.get_by_role('button', name='已标记', exact=True)
    yellow = 'rgb(251, 191, 36)'
    expect(mark.locator('svg path')).to_have_css('fill', yellow)
    mark_color = mark.evaluate('(element) => getComputedStyle(element).backgroundColor')
    mark.tap()
    expect(marked).to_have_css('background-color', mark_color)
    expect(marked.locator('svg path')).to_have_css('fill', yellow)
    page.get_by_role('button', name='切换明暗主题').tap()
    expect(page.locator('html')).to_have_attribute('data-theme', 'light')
    expect(marked.locator('svg path')).to_have_css('fill', yellow)
    page.get_by_role('button', name='切换明暗主题').tap()
    expect(page.locator('html')).to_have_attribute('data-theme', 'dark')
    next_item = page.get_by_role('button', name='下一题', exact=True)
    next_color = 'rgb(32, 42, 56)'
    expect(next_item).to_have_css('background-color', next_color)
    next_item.tap()
    expect(next_item).to_have_css('background-color', next_color)
    expect(next_item).to_be_enabled()
    expect(page.get_by_text('草稿已云端同步')).to_be_visible()
    page.reload(wait_until='domcontentloaded')
    expect(page.locator('.exam-nav-item.current')).to_have_text('3')
    expect(page.locator('.exam-nav-item.marked')).to_have_text('2')

    test_headers = {'Cookie': f'{COOKIE_NAME}={COOKIE_TOKEN}', 'Origin': ORIGIN, 'X-Study-Account': 'e2e-browser'}
    sessions = page.request.get(ORIGIN + '/api/exams', headers=test_headers).json()['exams']
    draft_id = next(entry['id'] for entry in sessions if entry['status'] == 'draft')
    draft_url = ORIGIN + '/api/exams/' + draft_id
    cloud = page.request.get(draft_url, headers=test_headers).json()['exam']
    assert page.request.put(draft_url, headers=test_headers, data={
        **{field: cloud[field] for field in ('revision', 'marked', 'answers')}, 'position': 3,
    }).ok
    mark.tap()
    expect(page.get_by_text('云端草稿已在别处更新', exact=False)).to_be_visible()
    expect(marked).to_be_disabled()
    expect(marked).to_have_css('opacity', '1')
    expect(marked.locator('svg path')).to_have_css('fill', yellow)
    draft_cache_key = f'cqu-study-draft:e2e-browser:{draft_id}'
    assert page.evaluate('(key) => localStorage.getItem(key)', draft_cache_key)
    page.route(draft_url, lambda route: route.fulfill(status=503, json={'error': '试卷暂时无法读取，请重试。'}), times=1)
    page.get_by_role('button', name='改用云端草稿').tap()
    expect(page.get_by_role('alert').filter(has_text='试卷暂时无法读取')).to_be_visible()
    assert page.evaluate('(key) => localStorage.getItem(key)', draft_cache_key)
    page.get_by_role('button', name='改用云端草稿').tap()
    expect(page.locator('.exam-nav-item.current')).to_have_text('4')
    assert page.evaluate('(key) => localStorage.getItem(key)', draft_cache_key) is None

    start = perf_counter()
    page.get_by_role('button', name='交卷', exact=True).click()
    expect(page.locator('.exam-result-item')).to_have_count(8)
    browser_exam_submit = milliseconds(start)
    expect(page.locator('.exam-score-total')).to_have_text('/ 8')
    expect(page.locator('.exam-score-num')).to_have_text('0')
    original = page.locator('.exam-result-question').all_inner_texts()
    expect(page.locator('.exam-result-item').nth(1).get_by_text('未作答', exact=False)).to_be_visible()
    expect(page.locator('.exam-result-actions').get_by_role('button', name='原卷重新考试', exact=True)).to_be_enabled()

    def wrong_row(text):
        return page.locator('.list-item').filter(has=page.get_by_text(text, exact=True))

    section(page, '/wrong')
    for text in original:
        expect(wrong_row(text)).to_have_count(1)
        expect(wrong_row(text).get_by_text('已答', exact=False)).to_be_visible()
    wrong_row(wrong_exam_stem).get_by_role('button', name='移出错题集').click()
    expect(wrong_row(wrong_exam_stem)).to_have_count(0)
    page.reload(wait_until='domcontentloaded')
    expect(wrong_row(original[1])).to_have_count(1)
    expect(wrong_row(wrong_exam_stem)).to_have_count(0)

    section(page, '/exam')
    check_exam_result_header(page).tap()
    expect(page.locator('.exam-nav-item')).to_have_count(8)
    expect(page.locator('.exam-nav-item.current')).to_have_text('1')
    expect(page.locator('.exam-nav-item.marked, .exam-nav-item.answered')).to_have_count(0)
    for index, text in enumerate(original, start=1):
        page.get_by_role('group', name='题目导航').get_by_role('button', name=str(index), exact=True).tap()
        expect(page.locator('.exam-question-card .q-text')).to_have_text(text)
    expect(next_item).to_be_disabled()
    page.get_by_role('group', name='题目导航').get_by_role('button', name='1', exact=True).tap()
    page.locator('.question-card .option').nth(wrong_option).click()
    page.get_by_role('button', name='交卷', exact=True).click()
    expect(page.locator('.exam-result-item')).to_have_count(8)
    section(page, '/wrong')
    for text in original:
        expect(wrong_row(text)).to_have_count(1)
    section(page, '/exam')
    page.get_by_role('button', name='返回', exact=True).click()
    page.get_by_role('button', name='历史记录').click()
    check_exam_history_header(page)
    expect(page.locator('.exam-history-score')).to_have_text([re.compile(r'^\d+/8$'), re.compile(r'^\d+/8$')])
    page.locator('.exam-history-item').last.click()
    expect(page.locator('.exam-result-question')).to_have_text(original)
    with page.expect_response(lambda response: response.url == draft_url + '/replay' and
                              response.request.method == 'POST') as replay_from_history:
        check_exam_result_header(page).tap()
    assert replay_from_history.value.ok
    replayed = replay_from_history.value.json()['exam']
    assert [item['stem'] for item in replayed['items']] == original
    assert replayed['answers'] == {} and replayed['marked'] == [] and replayed['position'] == 0
    expect(page.locator('.exam-nav-item.current')).to_have_text('1')
    page.get_by_role('button', name='交卷', exact=True).click()
    expect(page.locator('.exam-result-item')).to_have_count(8)
    with page.expect_response(lambda response: preference_write(response) and
                              response.request.post_data_json.get('exam', {}).get('screen') == 'entrance'):
        page.get_by_role('button', name='← 返回', exact=True).click()

    section(page, '/')
    expect(stem).to_be_visible()
    check_feedback(page)
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
    expect(page.locator('.site-title')).to_have_css('font-size', '22px')
    expect(page.locator('.site-title img')).to_have_css('width', '38px')
    nav = page.get_by_role('navigation', name='学习导航')
    before = nav.bounding_box()
    section(page, '/questions')
    expect(page.locator('.list-item').first).to_be_visible()
    assert page.evaluate('document.documentElement.scrollHeight > innerHeight')
    page.evaluate('window.scrollTo(0, 0)')
    after = nav.bounding_box()
    assert before and after
    route_shift = max(abs(before[axis] - after[axis]) for axis in ('x', 'y'))
    assert route_shift <= 1, f'Navigation shifted {route_shift:.2f} px across short and tall pages'
    section(page, '/exam')
    page.get_by_role('button', name='历史记录').click()
    check_exam_history_header(page)
    page.locator('.exam-history-item').first.click()
    replay = check_exam_result_header(page)
    expect(replay).to_have_css('background-color', 'rgb(158, 195, 247)')
    replay.hover()
    expect(replay).to_have_css('background-color', 'rgb(158, 195, 247)')
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
