import os
import re
from urllib.parse import urlsplit
from uuid import uuid4

from playwright.sync_api import expect, sync_playwright


ORIGIN = os.environ['EQB_TEST_ORIGIN']
COOKIE = os.environ['EQB_TEST_COOKIE_NAME']
HOST = urlsplit(ORIGIN).hostname
assert HOST in ('127.0.0.1', 'localhost')


def device(browser, token, **context_options):
    context = browser.new_context(service_workers='block', **context_options)
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
        article = page.get_by_role('article', name='练习题目')
        options = article.get_by_role('group', name='选择答案').get_by_role('button')
        attempts_url = ORIGIN + '/api/attempts/batch'
        headers = {'Cookie': f'{COOKIE}=rejection', 'Origin': ORIGIN, 'X-Study-Account': 'e2e-rejection'}
        stats = page.get_by_role('group', name='练习统计')
        expect(options.first).to_be_enabled()
        expect(stats.get_by_text('已练习', exact=True).locator('..')).to_have_text(re.compile(r'^0\s*已练习$'))

        def outdated(route):
            sent = route.request.post_data_json
            sent['events'][0]['contentRevision'] = '1' * 64
            result = page.request.post(attempts_url, headers=headers, data=sent)
            body = result.json()
            assert result.ok and body['results'][0]['status'] == 'unavailable'
            route.fulfill(json=body)

        def answer():
            options.first.click()
            if article.get_by_text('多选题', exact=True).count():
                page.get_by_role('button', name='确认提交', exact=True).click()

        page.route(attempts_url, outdated, times=1)
        answer()
        expect(page.get_by_text('本题作答未保存', exact=False)).to_be_visible()
        expect(options.first).to_be_enabled()
        expect(article.get_by_text('已答', exact=True)).to_have_count(0)
        expect(stats.get_by_text('已练习', exact=True).locator('..')).to_have_text(re.compile(r'^0\s*已练习$'))
        assert page.evaluate("Object.keys(localStorage).every(key => !key.startsWith('cqu-study-attempt:e2e-rejection:'))")
        answer()
        expect(article.get_by_text('已答', exact=True)).to_be_visible()
        expect(stats.get_by_text('已练习', exact=True).locator('..')).to_have_text(re.compile(r'^1\s*已练习$'))
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
        expect(primary.locator('main article').first).to_be_visible()
        stale.goto(ORIGIN + '/questions')
        single = lambda page: page.get_by_role('group', name='按题型筛选').get_by_role('button', name='单选', exact=True)
        expect(single(stale)).to_have_attribute('aria-pressed', 'false')
        with primary.expect_response(lambda r: r.url.endswith('/api/me/preferences') and
                                     r.request.post_data_json.get('library:all', {}).get('type') == 'single'):
            single(primary).click()
        size = stale.get_by_role('button', name=re.compile('每页题量'))
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
        expect(primary.get_by_role('button', name=re.compile('每页题量'))).to_have_text('50 题')
        item = primary.locator('main article').filter(has_not=primary.get_by_text('✓ 已答', exact=True)).first
        expect(item.get_by_role('button', name='显示答案', exact=True)).to_be_visible()
        item.get_by_role('button', name='展开解析', exact=True).click()
        reasons = item.get_by_role('list', name='选项解析').get_by_role('listitem')
        expect(reasons).to_have_count(4)
        for reason in reasons.all():
            expect(reason).to_contain_text(re.compile('（正确|（错误'))
            expect(reason.locator('p')).not_to_be_empty()
        item.get_by_role('button', name='收起解析').click()
        expect(reasons).to_have_count(0)
    finally:
        a.close()
        b.close()


def personal_library_pages(browser):
    context = device(browser, 'personal-library', viewport={'width': 390, 'height': 700}, is_mobile=True, has_touch=True)
    try:
        page = context.new_page()
        pagination = page.get_by_role('navigation', name='题库分页')
        position = pagination.get_by_label('当前页与总页数')
        previous = pagination.get_by_role('button', name='上一页')
        next_page = pagination.get_by_role('button', name='下一页')
        size = pagination.get_by_role('button', name='每页题量', exact=False)
        rows = page.locator('main article')

        for path, library, limit, page_count in [('/wrong', 'wrong', 10, 3), ('/favorites', 'favorite', 30, 1)]:
            page.goto(ORIGIN + path)
            expect(position).to_have_text('1 / 2')
            expect(previous).to_be_disabled()
            expect(size).to_have_text('20 题')
            expect(rows).to_have_count(20)
            next_page.scroll_into_view_if_needed()
            assert page.evaluate('scrollY > 0')
            next_page.tap()
            expect(position).to_have_text('2 / 2')
            expect(rows).to_have_count(1)
            expect(next_page).to_be_disabled()
            page.wait_for_function('scrollY === 0')
            previous.tap()
            expect(position).to_have_text('1 / 2')
            expect(rows).to_have_count(20)
            page.wait_for_function('scrollY === 0')

            next_page.tap()
            expect(position).to_have_text('2 / 2')
            size.tap()
            with page.expect_response(lambda r: r.url.endswith('/api/me/preferences') and
                                      (r.request.post_data_json or {}).get(f'library:{library}', {}).get('limit') == limit) as saved:
                pagination.get_by_role('button', name=f'{limit} 题', exact=True).tap()
            assert saved.value.ok
            expect(position).to_have_text(f'1 / {page_count}')
            expect(rows).to_have_count(min(limit, 21))
            page.reload()
            expect(size).to_have_text(f'{limit} 题')
            expect(position).to_have_text(f'1 / {page_count}')

        page.goto(ORIGIN + '/wrong')
        expect(size).to_have_text('10 题')
        expect(position).to_have_text('1 / 3')
    finally:
        context.close()


def paginated_inbox(browser):
    a, b = device(browser, 'author'), device(browser, 'author')
    try:
        primary, reader = a.new_page(), b.new_page()
        primary.goto(ORIGIN + '/#author-chat')
        primary.get_by_role('button', name='仅看未读').click()
        with primary.expect_response(lambda r: 'q=inbox-test-' in r.url):
            primary.get_by_role('searchbox', name='搜索会话').fill('inbox-test-')
        rows = primary.get_by_role('region', name='作者会话列表').get_by_role('link')
        expect(rows).to_have_count(30)
        primary.get_by_role('button', name='更多会话').click()
        expect(rows).to_have_count(32)
        expect(rows.and_(primary.locator('a[aria-describedby]'))).to_have_count(32)
        target = rows.last.locator('small').inner_text()
        thread_id = rows.last.get_attribute('href').split('/')[-1]
        path = ORIGIN + '/api/author-chat?thread=' + thread_id
        headers = {'Cookie': f'{COOKIE}=author', 'Origin': ORIGIN, 'X-Study-Account': 'e2e-author'}
        last = reader.request.get(path, headers=headers).json()['messages'][-1]['id']
        assert reader.request.put(path, headers=headers, data={'through': last}).ok
        expect(rows).to_have_count(31, timeout=18_000)
        expect(rows.and_(primary.locator('a[aria-describedby]'))).to_have_count(31)
        expect(primary.get_by_text(target, exact=True)).to_have_count(0)
    finally:
        a.close()
        b.close()


def practice_recovery(browser, token='recovery'):
    context = device(browser, token)
    try:
        page = context.new_page()
        owner = f'e2e-{token}'
        headers = {'Cookie': f'{COOKIE}={token}', 'Origin': ORIGIN, 'X-Study-Account': owner}
        qs = page.request.get(ORIGIN + '/api/public/questions?mode=practice&limit=15').json()['questions']
        pref_url = ORIGIN + '/api/me/preferences'
        assert page.request.put(pref_url, headers=headers, data={
            'practice': {'mode': 'sequence'}, 'practice-position:sequence': 2, 'practice-only-undone': False, 'theme': 'light',
        }).ok
        page.goto(ORIGIN + '/questions')
        pref_key = f'cqu-account-preferences:{owner}'
        trail_key = f'cqu-practice-history:{owner}:sequence'
        history = {'entries': [{'position': i, 'id': qs[i]['id']} for i in (1, 6, 2)], 'cursor': 2, 'filtered': False, 'empty': False}
        page.route(pref_url, lambda r: r.fulfill(status=503, json={'error': '临时不可用'}))
        page.evaluate("""([pref,trail,history]) => {
          localStorage.setItem(pref,JSON.stringify({values:{theme:'dark'},pending:{theme:'dark'}}))
          localStorage.setItem(trail,JSON.stringify(history))
        }""", [pref_key, trail_key, history])
        page.goto(ORIGIN + '/')
        article = page.get_by_role('article', name='练习题目')
        stem = article.get_by_role('heading', level=1)
        expect(stem).to_have_text(qs[2]['stem'])
        expect(page.locator('html')).to_have_attribute('data-theme', 'dark')
        assert page.evaluate("k=>JSON.parse(localStorage.getItem(k)).pending.theme", pref_key) == 'dark'
        assert page.evaluate("k=>JSON.parse(localStorage.getItem(k)).entries.map(x=>x.position)", trail_key) == [1, 6, 2]
        page.unroute(pref_url)
        with page.expect_response(lambda r: r.url == pref_url and r.ok and r.request.post_data_json.get('theme') == 'dark'):
            page.evaluate("window.dispatchEvent(new Event('online'))")
        article.get_by_role('button', name='上一题', exact=True).click()
        expect(stem).to_have_text(qs[6]['stem'])
        article.get_by_role('button', name='下一题', exact=True).click()
        expect(stem).to_have_text(qs[2]['stem'])
        page.evaluate('document.activeElement.blur()')
        page.keyboard.press('ArrowRight')
        expect(stem).to_have_text(qs[3]['stem'])
        assert page.get_by_role('spinbutton', name='跳转题号').input_value() == '4'
        page.keyboard.press('ArrowLeft')
        expect(stem).to_have_text(qs[2]['stem'])
        fav = article.get_by_role('button', name=re.compile('收藏'))
        previous = fav.get_attribute('aria-pressed')
        fav.focus()
        page.keyboard.press('Enter')
        expect(fav).to_have_attribute('aria-pressed', 'false' if previous == 'true' else 'true')
        expect(stem).to_have_text(qs[2]['stem'])
        assert article.get_by_role('button', name='重做本题').count() == 0
        posted = []
        page.on('request', lambda req: posted.append(req.url) if req.url.endswith('/api/attempts/batch') else None)
        page.get_by_role('link', name=re.compile('友情赞助')).first.click()
        expect(page.get_by_role('heading', name='友情赞助')).to_be_visible()
        for key in ('1', 'Enter', 'ArrowRight'):
            page.keyboard.press(key)
        page.wait_for_timeout(250)
        assert not posted, posted
        page.goto(ORIGIN + '/')
        total = page.request.get(ORIGIN + '/api/public/questions?mode=practice&limit=15').json()['total']
        page.get_by_role('spinbutton', name='跳转题号').fill(str(total))
        page.get_by_role('button', name='跳转', exact=True).click()
        expect(article.get_by_role('button', name='下一题', exact=True)).to_be_disabled()
        last = stem.inner_text()
        page.evaluate('document.activeElement.blur()')
        page.keyboard.press('ArrowRight')
        expect(stem).to_have_text(last)
        page.get_by_role('spinbutton', name='跳转题号').fill('5')
        page.get_by_role('button', name='跳转', exact=True).click()
        expect(stem).to_have_text(qs[4]['stem'])
        article.get_by_role('button', name='上一题', exact=True).click()
        expect(stem).to_have_text(last)
        page.reload()
        expect(stem).to_have_text(last)
        article.get_by_role('button', name='下一题', exact=True).click()
        expect(stem).to_have_text(qs[4]['stem'])
        print('PRACTICE_RECOVERY preference retry, visit history, focused shortcuts and last question passed', flush=True)
    finally:
        context.close()

def moved_bookmark(browser, token='bookmark-recovery'):
    context = device(browser, token)
    try:
        page = context.new_page()
        owner = f'e2e-{token}'
        headers = {'Cookie': f'{COOKIE}={token}', 'Origin': ORIGIN, 'X-Study-Account': owner}
        bank = ORIGIN + '/api/public/questions?mode=practice&limit=15'
        older = page.request.get(bank).json()['questions'][1]
        moved = page.request.get(bank + '&offset=15').json()['questions'][3]
        still_published = page.request.get(bank + '&offset=30').json()['questions'][0]
        last_batch = page.request.get(bank + '&offset=45').json()['questions']
        position = ORIGIN + '/api/public/questions/' + moved['id'] + '/position'
        assert page.request.get(position).json() == {'position': 18}
        assert page.request.get(position + '?topic=t02').json() == {'position': None}
        assert page.request.get(position + '?topic=t01&topic=t14').status == 400
        assert page.request.put(ORIGIN + '/api/me/preferences', headers=headers, data={
            'practice': {'mode': 'sequence'}, 'practice-position:sequence': 1,
        }).ok
        page.add_init_script(f"""localStorage.setItem('cqu-practice-history:{owner}:sequence', JSON.stringify({{
          entries: [{{position: 1, id: '{moved['id']}'}}, {{position: 95}}, {{position: 96, id: '{still_published['id']}'}},
            {{position: 97, id: '{uuid4()}'}}], cursor: 0
        }}));""")
        page.goto(ORIGIN)
        article = page.get_by_role('article', name='练习题目')
        expect(article.get_by_role('heading', level=1)).to_have_text(moved['stem'])
        expect(article).not_to_contain_text(older['stem'])
        assert page.evaluate('owner => { const h = JSON.parse(localStorage.getItem(`cqu-practice-history:${owner}:sequence`)); return h.entries[h.cursor].position }', owner) == 18
        article.get_by_role('button', name='下一题', exact=True).click()
        expect(article.get_by_role('heading', level=1)).to_have_text(still_published['stem'])
        article.get_by_role('button', name='下一题', exact=True).click()
        expect(article.get_by_role('heading', level=1)).to_have_text(last_batch[-1]['stem'])
        print('PRACTICE_MOVED_BOOKMARK restored the same question across batches', flush=True)
    finally:
        context.close()

def auth_and_chat_presentation(browser, token='recovery'):
    context_options = {'color_scheme': 'dark', 'ignore_https_errors': ORIGIN.startswith('https://')}
    desktop = browser.new_context(viewport={'width': 1440, 'height': 900}, **context_options)
    mobile = browser.new_context(viewport={'width': 440, 'height': 956}, is_mobile=True, has_touch=True, **context_options)
    try:
        page = desktop.new_page()
        page.goto(ORIGIN + '/login')
        screen = page.locator('main')
        expect(screen).to_have_css('color-scheme', 'light')
        page.get_by_role('button', name=re.compile('忘记密码')).click()
        expect(screen).to_have_css('color-scheme', 'light')
        page.evaluate('document.fonts.ready')
        assert page.evaluate("performance.getEntriesByType('resource').every(r => !/\\.woff2?(?:$|\\?)/.test(r.name))")

        for context in (desktop, mobile):
            context.add_cookies([{'name': COOKIE, 'value': token, 'domain': HOST, 'path': '/', 'secure': True}])
            page = context.new_page()
            page.goto(ORIGIN)
            expect(page.locator('html')).to_have_attribute('data-theme', 'dark')
            page.get_by_role('link', name='账号', exact=True).click()
            expect(page).to_have_url(ORIGIN + '/account')
            expect(page.locator('main')).to_have_css('color-scheme', 'dark')
            page.reload()
            expect(page.locator('main')).to_have_css('color-scheme', 'dark')

            page.goto(ORIGIN + '/#chat')
            composer = page.locator('textarea.chat-composer-input')
            expect(composer).to_be_enabled()
            if context is mobile:
                composer.tap()
            else:
                composer.click()
                page.keyboard.press('Tab')
                page.keyboard.press('Shift+Tab')
            expect(composer).to_be_focused()
            composer.fill('仅验证输入框样式')
            expect(composer).to_have_css('outline-style', 'none')
            expect(composer).to_have_value('仅验证输入框样式')
            expect(page.get_by_role('button', name='发送')).to_be_enabled()
        print('AUTH_CHAT_PRESENTATION auth light, account dark after reload, and composer focused without a frame', flush=True)
    finally:
        desktop.close()
        mobile.close()

def mobile_question_actions(browser, token='mobile-actions'):
    for width in (320, 390):
        context = device(browser, token, viewport={'width': width, 'height': 800}, is_mobile=True, has_touch=True)
        try:
            page = context.new_page()
            page.goto(ORIGIN + '/')
            article = page.get_by_role('article', name='练习题目')
            expect(article).to_be_visible()
            controls = page.locator('footer.glass-footer')
            expect(controls).to_be_visible()
            nav = page.locator('.community-footer')
            expect(nav).to_be_visible()
            actions = controls.get_by_role('button').all_text_contents()
            assert actions[-3:] == ['上一题', '下一题', '答题卡'], actions
            assert all(name in nav.inner_text() for name in ('聊天区', '意见反馈', '友情赞助'))
            for after_answer in (False, True):
                if after_answer:
                    article.get_by_role('group', name='选择答案').get_by_role('button').first.tap()
                    if article.get_by_text('多选题', exact=True).count():
                        controls.get_by_role('button', name='确认提交').tap()
                    expect(article.get_by_role('button', name='重做本题')).to_be_visible()
                result = controls.evaluate("""row=>{
                  const r=row.getBoundingClientRect(), q=document.querySelector('main article').getBoundingClientRect()
                  const community=document.querySelector('.community-footer').getBoundingClientRect()
                  return {position:getComputedStyle(row).position,gap:r.top-q.bottom,
                    communityGap:community.top-r.bottom,overflow:document.documentElement.scrollWidth-innerWidth,
                    rightmost:Math.max(...Array.from(row.querySelectorAll('button'),b=>b.getBoundingClientRect().right))}
                }""")
                assert result['position'] == 'static' and 0 <= result['gap'] <= 32 and result['communityGap'] >= 0, result
                assert result['overflow'] == 0 and result['rightmost'] <= width, result
                print(f'MOBILE_QUESTION_ACTIONS {width}px answered={after_answer} {result}', flush=True)
        finally:
            context.close()

def practice_error_controls(browser, token='recovery'):
    owner = f'e2e-{token}'
    headers = {'Cookie': f'{COOKIE}={token}', 'Origin': ORIGIN, 'X-Study-Account': owner}
    for width in (1280, 390):
        mobile = width < 1024
        context = device(browser, token, viewport={'width': width, 'height': 800}, is_mobile=mobile, has_touch=mobile)
        try:
            page = context.new_page()
            bank = page.request.get(ORIGIN + '/api/public/questions?mode=practice&limit=15').json()
            index = next(i for i, q in enumerate(bank['questions']) if q['type'] == 'single')
            assert page.request.put(ORIGIN + '/api/me/preferences', headers=headers, data={
                'practice': {'mode': 'sequence'}, 'practice-position:sequence': index, 'practice-only-undone': False,
            }).ok
            page.goto(ORIGIN + '/')
            article = page.get_by_role('article', name='练习题目')
            expect(article).to_contain_text(bank['questions'][index]['stem'])
            posts = []
            def fail_attempt(route):
                posts.append(route.request.url)
                route.fulfill(status=503, json={'error': '作答暂时无法同步'})
            batch = '**/api/attempts/batch'
            page.route(batch, fail_attempt)
            page.get_by_role('button', name='确认提交', exact=True).click()
            expect(article.get_by_role('alert')).to_have_text('请选择答案')
            assert not posts
            options = article.get_by_role('group', name='选择答案').get_by_role('button')
            expect(options.first).to_be_enabled()
            options.first.click()
            retry_sync = page.get_by_role('button', name='重试同步', exact=True)
            expect(retry_sync).to_be_visible()
            stats = '**/api/me/stats'
            page.route(stats, lambda r: r.fulfill(status=503, json={'error': '统计暂时不可用'}))
            article.get_by_role('button', name=re.compile('收藏')).click()
            retry_stats = page.get_by_role('button', name='重试统计', exact=True)
            expect(retry_stats).to_be_visible()
            undone = '**/api/me/practice-undone*'
            page.route(undone, lambda r: r.fulfill(status=503, json={'error': '未做题筛选暂时不可用'}))
            if mobile:
                page.get_by_role('button', name='打开练习设置与导航').click()
                dialog = page.get_by_role('dialog')
                dialog.get_by_role('button', name='只刷未做').click()
                dialog.get_by_role('button', name='完成', exact=True).click()
            else:
                page.get_by_role('group', name='练习模式').get_by_role('button', name='只刷未做').click()
            error = page.get_by_role('alert').filter(has_text='未做题筛选暂时不可用')
            expect(error).to_be_visible()
            expect(retry_sync).to_be_visible()
            expect(retry_stats).to_be_visible()
            page.unroute(stats)
            retry_stats.click()
            expect(retry_stats).to_have_count(0)
            if mobile:
                page.get_by_role('button', name='查看学习概览与社区入口').click()
                tiles = page.get_by_role('dialog')
            else:
                tiles = page.get_by_role('group', name='练习统计')
            for label in ('已练习', '错题', '收藏'):
                value = tiles.get_by_text(label, exact=True).locator('..')
                expect(value).to_have_text(re.compile(r'^\d+\s*' + label + '$'))
            if mobile:
                tiles.get_by_role('button', name='关闭').click()
            page.unroute(batch)
            retry_sync.click()
            expect(page.get_by_text('云端已同步', exact=True)).to_be_visible()
            page.unroute(undone)
            error.get_by_role('button', name='重试', exact=True).click()
            expect(article).to_be_visible()
            print(f'PRACTICE_ERRORS {width}px empty validation, statistics, attempt/filter/stats retries passed', flush=True)
        finally:
            context.close()

def touch_navigation(browser, token='touch'):
    context = device(browser, token, viewport={'width': 390, 'height': 540}, is_mobile=True, has_touch=True)
    try:
        page = context.new_page()
        owner = f'e2e-{token}'
        headers = {'Cookie': f'{COOKIE}={token}', 'Origin': ORIGIN, 'X-Study-Account': owner}
        bank = page.request.get(ORIGIN + '/api/public/questions?mode=practice&limit=15').json()
        i = next(i for i, q in enumerate(bank['questions'][:-1]) if q['type'] == 'single')
        assert page.request.put(ORIGIN + '/api/me/preferences', headers=headers, data={
            'practice': {'mode': 'sequence'}, 'practice-position:sequence': i, 'practice-only-undone': False,
        }).ok
        page.add_init_script("""
          window.practiceMoves = {native: 0, claimed: 0}
          window.addEventListener('touchmove', e => {
            window.practiceMoves[e.defaultPrevented ? 'claimed' : 'native']++
          }, {passive: true})
        """)

        page.goto(ORIGIN + '/')
        article = page.get_by_role('article', name='练习题目')
        stem = article.get_by_role('heading', level=1)
        expect(stem).to_have_text(bank['questions'][i]['stem'])
        options = article.get_by_role('group', name='选择答案').get_by_role('button')
        driver = context.new_cdp_session(page)
        posted = []
        page.on('request', lambda req: posted.append(req.url) if req.url.endswith('/api/attempts/batch') else None)

        def swipe(x1, x2, dy=0):
            options.first.scroll_into_view_if_needed()
            rect = options.first.bounding_box()
            y = int(rect['y'] + rect['height'] / 2)
            def touch(kind, x, y):
                driver.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [] if kind == 'touchEnd' else [{'x': x, 'y': y}]})
            before = page.evaluate('({...window.practiceMoves})')
            touch('touchStart', x1, y)
            for step in range(1, 9):
                touch('touchMove', x1 + (x2-x1)*step/8, y + dy*step/8)
                page.wait_for_timeout(16)
            touch('touchEnd', x2, y+dy)
            after = page.evaluate('({...window.practiceMoves})')
            return {key: value - before[key] for key, value in after.items()}

        assert swipe(280, 100)['claimed'] > 0
        expect(stem).to_have_text(bank['questions'][i+1]['stem'])
        swipe(100, 280)
        expect(stem).to_have_text(bank['questions'][i]['stem'])
        assert not posted, posted
        with page.expect_response(lambda r: r.url.endswith('/api/attempts/batch') and r.ok):
            options.first.tap()
            expect(article.get_by_role('button', name='重做本题')).to_be_visible()
        assert len(posted) == 1
        swipe(280, 100)
        expect(stem).to_have_text(bank['questions'][i+1]['stem'])
        page.get_by_role('button', name='答题卡').tap()
        drawer = page.get_by_role('dialog', name='答题卡', exact=True)
        expect(drawer).to_be_visible()
        expect(drawer.get_by_role('spinbutton', name='跳转题号')).to_have_attribute('max', str(bank['total']))
        drawer.get_by_role('spinbutton', name='跳转题号').fill(str(bank['total']))
        drawer.get_by_role('button', name='跳转').tap()
        expect(page.get_by_role('button', name='下一题', exact=True)).to_be_disabled()
        last_stem = stem.inner_text()
        swipe(280, 100)
        expect(stem).to_have_text(last_stem)
        assert len(posted) == 1
        # A fresh topic with fewer cells than the desktop sheet window must still allow a numeric jump.
        page.goto(ORIGIN + '/questions')
        topics = page.request.get(ORIGIN + '/api/public/topics').json()['topics']
        topic = next(t for t in topics if 0 < t['count'] < 35)
        assert page.request.put(ORIGIN + '/api/me/preferences', headers=headers, data={
            'practice': {'mode': 'topic', 'topic': topic['id']}, 'practice-only-undone': False,
        }).ok
        page.goto(ORIGIN + '/')
        expect(article).to_contain_text(f"/ {topic['count']}")
        page.get_by_role('button', name='答题卡').tap()
        expect(drawer).to_be_visible()
        number = drawer.get_by_role('spinbutton', name='跳转题号')
        expect(number).to_have_attribute('max', str(topic['count']))
        number.fill(str(topic['count']))
        drawer.get_by_role('button', name='跳转').tap()
        expect(article).to_contain_text(f"{topic['count']} / {topic['count']}")
        expect(page.get_by_role('button', name='下一题', exact=True)).to_be_disabled()
        last_stem = stem.inner_text()
        # Finish with native scrolling. During a fling the first physical tap can stop scrolling without opening a control.
        options.first.scroll_into_view_if_needed()
        start_y, max_y = page.evaluate('() => [scrollY, document.documentElement.scrollHeight - innerHeight]')
        vertical = swipe(150, 145, -95 if max_y - start_y > 40 else 95)
        assert vertical['native'] > 0 and vertical['claimed'] == 0, vertical
        expect(stem).to_have_text(last_stem)
        page.wait_for_function('y => Math.abs(scrollY-y) > 5', arg=start_y)
        assert len(posted) == 1
        # The viewport edge belongs to the browser. A platform back gesture may consume the next native tap.
        last_topic_stem = stem.inner_text()
        edge = swipe(26, 155)
        assert edge['native'] > 0 and edge['claimed'] == 0, edge
        expect(stem).to_have_text(last_topic_stem)
        assert len(posted) == 1
        print(f"TOUCH_NAVIGATION left/right, vertical scroll, edge, tap, sequence ({bank['total']}), short topic ({topic['count']}) and last item passed", flush=True)
    finally:
        context.close()

def explanation_links(browser, token='source-links'):
    context = device(browser, token)
    try:
        page = context.new_page()
        owner = f'e2e-{token}'
        headers = {'Cookie': f'{COOKIE}={token}', 'Origin': ORIGIN, 'X-Study-Account': owner}
        question = page.request.get(ORIGIN + '/api/public/questions?mode=practice&limit=15').json()['questions'][0]
        question_id = question['id']
        wrong_id = next((o['id'] for o in question['options'] if o['id'] not in question['answerIds']), question['options'][0]['id'])
        saved = page.request.post(ORIGIN + '/api/attempts/batch', headers=headers, data={'ownerId': owner, 'events': [{
            'mode': 'practice', 'eventId': str(uuid4()), 'questionId': question_id, 'optionIds': [wrong_id],
            **({'contentRevision': question['contentRevision']} if question.get('contentRevision') else {}),
        }]}).json()
        assert saved['results'][0]['status'] == 'saved'
        assert page.request.put(f'{ORIGIN}/api/me/favorites/{question_id}', headers=headers, data={'favorite': True}).ok
        prefs = {'practice': {'mode': 'sequence'}, 'practice-position:sequence': 0, 'practice-only-undone': False, 'theme': 'light', 'exam': {'screen': 'entrance'}}
        for scope in ('all', 'wrong', 'favorite'):
            prefs['library:' + scope] = {'page': 0, 'limit': 20, 'topic': '', 'search': '', 'type': '', 'status': ''}
        assert page.request.put(ORIGIN + '/api/me/preferences', headers=headers, data=prefs).ok
        created = page.request.post(ORIGIN + '/api/exams', headers=headers, data={'questionCount': 2}).json()['exam']
        finalized = page.request.post(f"{ORIGIN}/api/exams/{created['id']}/submit", headers=headers, data={
            'position': 0, 'revision': created['revision'], 'answers': {}, 'marked': [],
        }).json()['exam']
        assert finalized['status'] == 'submitted'

        for path in ('/', '/questions', '/wrong', '/favorites', '/exam'):
            page.goto(ORIGIN + path)
            if path == '/exam':
                history = page.get_by_role('button', name=re.compile('历史记录'))
                history.click()
                page.get_by_role('button', name=re.compile('用时.*分')).first.click()
            article = page.locator('main article').first
            button = article.get_by_role('button', name='展开解析', exact=True)
            button.click()
            reasons = article.get_by_role('list', name='选项解析')
            expect(reasons.get_by_role('listitem')).to_have_count(len(question['options']))
            source = article.locator('a[target="_blank"]').first
            expect(source).to_be_visible()
            theme = page.get_by_role('button', name='切换明暗主题')
            for dark in (False, True):
                desired = 'dark' if dark else 'light'
                if page.locator('html').get_attribute('data-theme') != desired:
                    theme.click()
                expect(page.locator('html')).to_have_attribute('data-theme', desired)
                color = 'rgb(148, 163, 184)' if dark else 'rgb(100, 106, 115)'
                expect(source).to_have_css('color', color)
                expect(source).to_have_css('text-decoration-line', 'underline')
                # Browsers mask visited colors in getComputedStyle. Check the actual emitted visited rule separately.
                assert source.evaluate("""el => {
                  const rules = Array.from(document.styleSheets).flatMap(sheet => {
                    try { return Array.from(sheet.cssRules) } catch { return [] }
                  })
                  return rules.some(rule => rule.cssText.includes(CSS.escape('visited:text-ink-secondary') + ':visited') && rule.cssText.includes('--ink-secondary'))
                    && el.classList.contains('visited:text-ink-secondary')
                }""")
                if path == '/exam':
                    collapsed = article.get_by_role('button', name='展开解析', exact=True)
                    if collapsed.count():
                        collapsed.click()
                expect(source.locator('xpath=ancestor::*[@inert]')).to_have_count(0)
                page.keyboard.press('Tab')
                source.focus()
                expect(source).to_be_focused()
                expect(source).to_have_css('outline-style', 'solid')
                expect(source).to_have_css('outline-width', '2px')
            if path in ('/questions', '/wrong', '/favorites'):
                answer = article.get_by_text(re.compile(r'^正确答案'))
                expect(answer).to_be_visible()
                article.get_by_role('button', name='收起解析', exact=True).click()
                expect(answer).to_have_count(0)
                article.get_by_role('button', name='显示答案', exact=True).click()
                article.get_by_role('button', name='展开解析', exact=True).click()
                article.get_by_role('button', name='收起解析', exact=True).click()
                expect(answer).to_be_visible()
            if path == '/':
                article.get_by_role('button', name='收起解析', exact=True).click()
                page.mouse.move(1, 1)
                expect(button).to_have_css('background-color', 'rgb(23, 25, 31)')
                expect(button).to_have_css('color', 'rgb(148, 163, 184)')
                button.hover()
                expect(button).to_have_css('background-color', 'rgb(31, 34, 42)')
                button.click()
                expect(source).to_be_visible()
            print(f'SOURCE_LINK verified {path} light/dark/underline/focus', flush=True)
    finally:
        context.close()


if __name__ == '__main__':
    with sync_playwright() as playwright:
        chromium = playwright.chromium.launch(headless=True)
        try:
            rejected_answer(chromium)
            library_preferences(chromium)
            personal_library_pages(chromium)
            paginated_inbox(chromium)
            practice_recovery(chromium)
            moved_bookmark(chromium)
            auth_and_chat_presentation(chromium)
            practice_error_controls(chromium)
            touch_navigation(chromium)
            mobile_question_actions(chromium)
            explanation_links(chromium)
            print('ADDITIONAL_BROWSER_E2E rejected answer, cross-device library fields, personal library pagination, second-page unread refresh')
        finally:
            chromium.close()
