from playwright.sync_api import expect


def check_exam_receipts(browser, origin, host, cookie_name):
    context = browser.new_context(service_workers='block')
    context.add_cookies([{
        'name': cookie_name, 'value': 'receipt', 'domain': host, 'path': '/',
        'secure': True, 'httpOnly': True, 'sameSite': 'Strict',
    }])
    page = context.new_page()
    headers = {'Cookie': f'{cookie_name}=receipt', 'Origin': origin, 'X-Study-Account': 'e2e-receipt'}
    traffic = []
    page.on('response', lambda r: traffic.append((r.request.method, r.status)) if '/api/exams/' in r.url else None)
    page.on('requestfailed', lambda r: traffic.append((r.method, r.failure)) if '/api/exams/' in r.url else None)

    def drop_receipt(route):
        committed = route.fetch(headers={**route.request.headers, **headers})
        assert committed.ok, committed.text()
        route.fulfill(status=502, content_type='application/json', body='{"error":"验收代理未收到回执"}')

    try:
        page.goto(origin + '/exam')
        page.get_by_role('spinbutton', name='题数').fill('8')
        with page.expect_response(lambda response: response.url.endswith('/api/exams') and
                                  response.request.method == 'POST') as started:
            page.get_by_role('button', name='开始考试').click()
        draft_path = origin + '/api/exams/' + started.value.json()['exam']['id']
        page.set_viewport_size({'width': 390, 'height': 350})
        progress = page.get_by_role('progressbar', name='答题进度')
        expect(progress).to_have_count(1)
        expect(progress).to_be_visible()
        expect(progress).to_have_attribute('aria-valuemin', '0')
        expect(progress).to_have_attribute('aria-valuenow', '0')
        expect(progress).to_have_attribute('aria-valuemax', '8')
        options = page.get_by_role('group', name='选择答案')
        actions = page.get_by_role('navigation', name='试题操作')
        actions.scroll_into_view_if_needed()
        options_box, actions_box = options.bounding_box(), actions.bounding_box()
        assert 0 <= actions_box['y'] - options_box['y'] - options_box['height'] <= 20
        assert actions.evaluate("(nav) => getComputedStyle(nav).position") != 'fixed'
        assert page.locator('footer:has(a[href="#feedback"])').bounding_box()['y'] >= actions_box['y'] + actions_box['height']
        actions.get_by_role('button', name='答题卡').click()
        page.get_by_role('group', name='题目导航').get_by_role('button').first.click()
        page.set_viewport_size({'width': 1280, 'height': 820})
        page.route(draft_path + '?ack=1', drop_receipt, times=1)
        with page.expect_response(lambda res: res.url == draft_path + '?ack=1' and res.status == 502):
            page.locator('article[aria-label=当前考题] [role=group] button').first.click()
        try:
            expect(page.get_by_text('草稿已云端同步')).to_be_visible(timeout=12_000)
        except AssertionError:
            remote = page.request.get(draft_path, headers=headers).json()['exam']
            raise AssertionError({
                'traffic': traffic,
                'status': page.locator('main [role=status]').all_text_contents(),
                'online': page.evaluate('navigator.onLine'),
                'remote': {key: remote[key] for key in ('status', 'revision', 'position')},
                'stored': page.evaluate("""() => {
                    const key = Object.keys(localStorage).find(key => key.startsWith('cqu-study-draft:e2e-receipt:'));
                    const draft = JSON.parse(localStorage.getItem(key ?? '') || '{}');
                    return Object.fromEntries(Object.entries(draft).map(([name, value]) =>
                        [name, { revision: value.revision, position: value.position }]));
                }"""),
            }) from None
        expect(page.locator('[aria-label=题目导航]:visible button[aria-label*=已答]')).to_have_text('1')
        for width in (390, 1280):
            page.set_viewport_size({'width': width, 'height': 820})
            expect(progress).to_have_count(1)
            expect(progress).to_have_attribute('aria-valuenow', '1')
            expect(progress).to_have_attribute('aria-valuemax', '8')
        assert len(page.request.get(draft_path, headers=headers).json()['exam']['answers']) == 1

        submit_path = draft_path + '/submit'
        page.route(submit_path, drop_receipt, times=1)
        page.get_by_role('button', name='交卷', exact=True).click()
        with page.expect_response(lambda res: res.url == submit_path and res.status == 502):
            page.get_by_role('dialog').get_by_role('button', name='确认交卷', exact=True).click()
        expect(page.locator('main article')).to_have_count(8, timeout=12_000)
        result = page.request.get(draft_path, headers=headers).json()['exam']
        assert result['status'] == 'submitted'
        expect(page.locator('output[aria-label=考试得分]')).to_have_text(str(result['score']))
    finally:
        context.close()


def check_exam_conflict(browser, origin, host, cookie_name):
    def device():
        context = browser.new_context(service_workers='block')
        context.add_cookies([{
            'name': cookie_name, 'value': 'conflict', 'domain': host, 'path': '/',
            'secure': True, 'httpOnly': True, 'sameSite': 'Strict',
        }])
        return context

    def pick(page, question, option):
        page.locator('[aria-label=题目导航]:visible button').nth(question - 1).click()
        expect(page.locator('[aria-label=题目导航]:visible button[aria-current=step]')).to_have_text(str(question))
        page.locator('article[aria-label=当前考题] [role=group] button').nth(option).click()

    def mark(page, question):
        page.locator('[aria-label=题目导航]:visible button').nth(question - 1).click()
        page.get_by_role('button', name='标记', exact=True).click()

    def synced(page):
        expect(page.get_by_text('草稿已云端同步')).to_be_visible()

    def hand_in(page):
        page.get_by_role('button', name='交卷', exact=True).click()
        page.get_by_role('dialog').get_by_role('button', name='确认交卷', exact=True).click()

    def answered(page, positions):
        expect(page.locator('[aria-label=题目导航]:visible button[aria-label*=已答]')).to_have_text([str(position) for position in positions])

    first, second = device(), device()
    primary, lagging = first.new_page(), second.new_page()
    try:
        primary.goto(origin + '/exam')
        primary.get_by_role('spinbutton', name='题数').fill('8')
        primary.get_by_role('button', name='开始考试').click()
        expect(primary.locator('[aria-label=题目导航]:visible button')).to_have_count(8)

        def cancel_leave(dialog):
            dialog.dismiss()

        primary.on('dialog', cancel_leave)
        for fragment in ['chat', 'feedback', 'sponsor']:
            with primary.expect_event('dialog') as prompt:
                primary.locator(f'footer a[href="#{fragment}"]:visible').click()
            assert '正在考试中' in prompt.value.message
            expect(primary.locator('article[aria-label=当前考题]')).to_be_visible()
            expect(primary).to_have_url(origin + '/exam')
        primary.remove_listener('dialog', cancel_leave)
        accept_leave = lambda dialog: dialog.accept()
        primary.on('dialog', accept_leave)
        primary.locator('footer a[href="#sponsor"]:visible').click()
        expect(primary.get_by_role('heading', name='友情赞助')).to_be_visible()
        primary.get_by_role('link', name='← 返回练习').click()
        expect(primary.locator('[aria-label=题目导航]:visible button[aria-current=step]')).to_have_text('1')
        primary.remove_listener('dialog', accept_leave)

        lagging.goto(origin + '/exam')
        resume = lagging.get_by_role('button', name='继续上次考试')
        expect(resume.or_(lagging.locator('[aria-label=题目导航]:visible button').first)).to_be_visible()
        if resume.is_visible():
            resume.click()
        expect(lagging.locator('[aria-label=题目导航]:visible button')).to_have_count(8)

        second.set_offline(True)
        pick(primary, 1, 0)
        mark(primary, 4)
        synced(primary)
        pick(lagging, 2, 1)
        mark(lagging, 5)
        expect(lagging.get_by_text('草稿同步失败')).to_be_visible()
        second.set_offline(False)
        synced(lagging)
        answered(lagging, [1, 2])
        expect(lagging.locator('[aria-label=题目导航]:visible button[aria-label*=已标记]')).to_have_text(['4', '5'])

        primary.reload()
        answered(primary, [1, 2])
        second.set_offline(True)
        pick(primary, 3, 0)
        synced(primary)
        pick(lagging, 3, 2)
        expect(lagging.get_by_text('草稿同步失败')).to_be_visible()
        second.set_offline(False)
        review = lagging.get_by_role('form', name='确认冲突的答案')
        expect(review).to_be_visible()
        expect(review.get_by_role('group')).to_have_count(1)
        expect(lagging.get_by_role('button', name='交卷', exact=True)).to_be_disabled()
        lagging.reload()
        expect(review).to_be_visible()
        expect(review.get_by_role('button', name='合并并继续')).to_be_disabled()
        expect(review.get_by_role('radio', name='云端答案 · A')).to_be_visible()
        review.get_by_role('radio', name='本机答案 · C').check()
        review.get_by_role('button', name='合并并继续').click()
        synced(lagging)
        expect(review).to_have_count(0)
        answered(lagging, [1, 2, 3])
        lagging.locator('[aria-label=题目导航]:visible button').nth(2).click()
        expect(lagging.locator('article[aria-label=当前考题] [role=group] button').nth(2)).to_have_attribute('aria-pressed', 'true')
        synced(lagging)

        primary.reload()
        answered(primary, [1, 2, 3])
        pick(primary, 6, 0)
        synced(primary)
        first.set_offline(True)
        pick(primary, 7, 1)
        expect(primary.get_by_text('草稿同步失败')).to_be_visible()

        hand_in(lagging)
        expect(lagging.get_by_text('草稿已更新，请核对答案后再交卷。')).to_be_visible()
        answered(lagging, [1, 2, 3, 6])
        expect(lagging.get_by_role('heading', name='考试结果')).to_have_count(0)
        hand_in(lagging)
        expect(lagging.locator('main article')).to_have_count(8)
        expect(lagging.locator('main article').nth(6)).to_contain_text('未作答')

        first.set_offline(False)
        expect(primary.locator('main article')).to_have_count(8)
        expect(primary.get_by_text('这份试卷已交卷，以下是云端结果。')).to_be_visible()
        primary.reload()
        primary.get_by_text('本机有 1 道题的未同步答案').click()
        expect(primary.locator("details:has(summary:text('本机有')) li")).to_have_text('第 7 题 · B')
    finally:
        first.close()
        second.close()
