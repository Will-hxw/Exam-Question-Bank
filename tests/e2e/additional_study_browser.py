import os
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright


ORIGIN = os.environ['EQB_TEST_ORIGIN']
COOKIE = os.environ['EQB_TEST_COOKIE_NAME']
HOST = urlsplit(ORIGIN).hostname
assert HOST in ('127.0.0.1', 'localhost')


def device(browser, token):
    context = browser.new_context(service_workers='block')
    context.add_cookies([{
        'name': COOKIE, 'value': token, 'domain': HOST, 'path': '/',
        'secure': True, 'httpOnly': True, 'sameSite': 'Strict',
    }])
    return context


def rejected_answer(browser):
    context = device(browser, 'rejection')
    try:
        page = context.new_page()
        page.goto(ORIGIN + '/')
        page.get_by_role('group', name='练习模式').get_by_role('button', name='顺序').click()
        options = page.get_by_role('article', name='练习题目').locator('.option')
        attempts_url = ORIGIN + '/api/attempts/batch'
        headers = {'Cookie': f'{COOKIE}=rejection', 'Origin': ORIGIN, 'X-Study-Account': 'e2e-rejection'}
        stats = page.get_by_role('list', name='练习统计')
        expect(options.first).to_be_enabled()
        expect(stats).to_contain_text('已练习 0')

        def outdated(route):
            sent = route.request.post_data_json
            sent['events'][0]['contentRevision'] = '1' * 64
            result = page.request.post(attempts_url, headers=headers, data=sent)
            body = result.json()
            assert result.ok and body['results'][0]['status'] == 'unavailable'
            route.fulfill(json=body)

        def answer():
            options.first.click()
            if page.locator('.question-card .q-type').inner_text() == '多选题':
                page.get_by_role('button', name='确定', exact=True).click()

        page.route(attempts_url, outdated, times=1)
        answer()
        expect(page.get_by_text('本题作答未保存', exact=False)).to_be_visible()
        expect(options.first).to_be_enabled()
        expect(page.locator('.done-badge')).to_have_count(0)
        expect(stats).to_contain_text('已练习 0')
        assert page.evaluate("Object.keys(localStorage).every(key => !key.startsWith('cqu-study-attempt:e2e-rejection:'))")
        answer()
        expect(page.locator('.done-badge')).to_be_visible()
        expect(stats).to_contain_text('已练习 1')
    finally:
        context.close()


def library_preferences(browser):
    a, b = device(browser, 'conflict'), device(browser, 'conflict')
    try:
        primary, stale = a.new_page(), b.new_page()
        primary.goto(ORIGIN + '/questions#feedback')
        expect(primary.get_by_role('heading', name='意见反馈')).to_be_visible()
        primary.get_by_role('link', name='刷题', exact=True).click()
        expect(primary).to_have_url(ORIGIN + '/')
        primary.get_by_role('link', name='总题库', exact=True).click()
        expect(primary).to_have_url(ORIGIN + '/questions')
        expect(primary.locator('.list-item').first).to_be_visible()
        stale.goto(ORIGIN + '/questions')
        single = lambda page: page.get_by_role('group', name='按题型筛选').get_by_role('button', name='单选', exact=True)
        expect(single(stale)).to_have_attribute('aria-pressed', 'false')
        with primary.expect_response(lambda r: r.url.endswith('/api/me/preferences') and
                                     r.request.post_data_json.get('library:all', {}).get('type') == 'single'):
            single(primary).click()
        size = stale.locator('.pagination-size .topic-dropdown-btn')
        expect(size).to_have_text('20 题')
        size.click()
        with stale.expect_response(lambda r: r.url.endswith('/api/me/preferences') and
                                   r.request.post_data_json.get('library:all', {}).get('limit') == 50) as saved:
            stale.get_by_role('button', name='50 题', exact=True).click()
        assert saved.value.ok
        expect(single(stale)).to_have_attribute('aria-pressed', 'true')
        expect(size).to_have_text('50 题')
        primary.reload()
        expect(single(primary)).to_have_attribute('aria-pressed', 'true')
        expect(primary.locator('.pagination-size .topic-dropdown-btn')).to_have_text('50 题')
        item = primary.locator('.list-item').filter(has_not=primary.locator('.done-badge')).first
        item.get_by_role('button', name='显示答案', exact=True).click()
        expect(item.get_by_role('button', name='展开解析', exact=True)).to_be_disabled()
    finally:
        a.close()
        b.close()


def paginated_inbox(browser):
    a, b = device(browser, 'author'), device(browser, 'author')
    try:
        primary, reader = a.new_page(), b.new_page()
        primary.goto(ORIGIN + '/#author-chat')
        primary.get_by_role('button', name='仅看未读').click()
        with primary.expect_response(lambda r: 'q=inbox-test-' in r.url):
            primary.get_by_role('searchbox', name='搜索会话').fill('inbox-test-')
        rows = primary.locator('.author-inbox-row')
        expect(rows).to_have_count(30)
        primary.get_by_role('button', name='更多会话').click()
        expect(rows).to_have_count(32)
        expect(rows.locator('.message-unread-dot')).to_have_count(32)
        target = rows.last.locator('small').inner_text()
        thread_id = rows.last.get_attribute('href').split('/')[-1]
        path = ORIGIN + '/api/author-chat?thread=' + thread_id
        headers = {'Cookie': f'{COOKIE}=author', 'Origin': ORIGIN, 'X-Study-Account': 'e2e-author'}
        last = reader.request.get(path, headers=headers).json()['messages'][-1]['id']
        assert reader.request.put(path, headers=headers, data={'through': last}).ok
        expect(rows).to_have_count(31, timeout=18_000)
        expect(rows.locator('.message-unread-dot')).to_have_count(31)
        expect(primary.get_by_text(target, exact=True)).to_have_count(0)
    finally:
        a.close()
        b.close()


with sync_playwright() as playwright:
    chromium = playwright.chromium.launch(headless=True)
    try:
        rejected_answer(chromium)
        library_preferences(chromium)
        paginated_inbox(chromium)
        print('ADDITIONAL_BROWSER_E2E rejected answer, cross-device library fields, second-page unread refresh')
    finally:
        chromium.close()
