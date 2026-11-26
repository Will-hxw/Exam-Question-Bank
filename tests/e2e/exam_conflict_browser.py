from playwright.sync_api import expect


def check_exam_conflict(browser, origin, host, cookie_name):
    def device():
        context = browser.new_context(service_workers='block')
        context.add_cookies([{
            'name': cookie_name, 'value': 'conflict', 'domain': host, 'path': '/',
            'secure': True, 'httpOnly': True, 'sameSite': 'Strict',
        }])
        return context

    def pick(page, question, option):
        page.locator('.exam-nav-item').nth(question - 1).click()
        expect(page.locator('.exam-nav-item.current')).to_have_text(str(question))
        page.locator('.exam-question-card .option').nth(option).click()

    def mark(page, question):
        page.locator('.exam-nav-item').nth(question - 1).click()
        page.get_by_role('button', name='标记', exact=True).click()

    def synced(page):
        expect(page.get_by_text('草稿已云端同步')).to_be_visible()

    def hand_in(page):
        page.get_by_role('button', name='交卷', exact=True).click()
        page.get_by_role('dialog').get_by_role('button', name='确认交卷', exact=True).click()

    def answered(page, positions):
        expect(page.locator('.exam-nav-item.answered')).to_have_text([str(position) for position in positions])

    first, second = device(), device()
    primary, lagging = first.new_page(), second.new_page()
    receipts_lost = []
    headers = {'Cookie': f'{cookie_name}=conflict', 'Origin': origin, 'X-Study-Account': 'e2e-conflict'}

    def drop_receipt(route):
        committed = route.request.frame.page.request.fetch(
            route.request.url, method=route.request.method, headers=headers,
            data=route.request.post_data_json,
        )
        assert committed.ok, committed.text()
        receipts_lost.append(route.request.method)
        route.abort('connectionreset')

    try:
        primary.goto(origin + '/exam')
        primary.get_by_role('spinbutton', name='题数').fill('8')
        primary.get_by_role('button', name='开始考试').click()
        expect(primary.locator('.exam-nav-item')).to_have_count(8)

        def cancel_leave(dialog):
            dialog.dismiss()

        primary.on('dialog', cancel_leave)
        for link in ['打开聊天区', '打开意见反馈页面', '打开友情赞助页面']:
            with primary.expect_event('dialog') as prompt:
                primary.get_by_role('link', name=link).click()
            assert '正在考试中' in prompt.value.message
            expect(primary.locator('.exam-question-card')).to_be_visible()
            expect(primary).to_have_url(origin + '/exam')
        primary.remove_listener('dialog', cancel_leave)
        accept_leave = lambda dialog: dialog.accept()
        primary.on('dialog', accept_leave)
        primary.get_by_role('link', name='打开友情赞助页面').click()
        expect(primary.get_by_role('heading', name='友情赞助')).to_be_visible()
        primary.get_by_role('link', name='← 返回练习').click()
        expect(primary.locator('.exam-nav-item.current')).to_have_text('1')
        primary.remove_listener('dialog', accept_leave)

        lagging.goto(origin + '/exam')
        resume = lagging.get_by_role('button', name='继续上次考试')
        expect(resume.or_(lagging.locator('.exam-nav-item').first)).to_be_visible()
        if resume.is_visible():
            resume.click()
        expect(lagging.locator('.exam-nav-item')).to_have_count(8)

        second.set_offline(True)
        primary.route('**/api/exams/*?ack=1', drop_receipt, times=1)
        pick(primary, 1, 0)
        mark(primary, 4)
        synced(primary)
        pick(lagging, 2, 1)
        mark(lagging, 5)
        expect(lagging.get_by_text('草稿同步失败')).to_be_visible()
        second.set_offline(False)
        synced(lagging)
        answered(lagging, [1, 2])
        expect(lagging.locator('.exam-nav-item.marked')).to_have_text(['4', '5'])

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
        lagging.locator('.exam-nav-item').nth(2).click()
        expect(lagging.locator('.exam-question-card .option').nth(2)).to_have_attribute('aria-pressed', 'true')
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
        lagging.route('**/api/exams/*/submit', drop_receipt, times=1)
        hand_in(lagging)
        expect(lagging.locator('.exam-result-item')).to_have_count(8)
        assert receipts_lost == ['PUT', 'POST']
        expect(lagging.locator('.exam-result-item').nth(6)).to_contain_text('未作答')

        first.set_offline(False)
        expect(primary.locator('.exam-result-item')).to_have_count(8)
        expect(primary.get_by_text('这份试卷已交卷，以下是云端结果。')).to_be_visible()
        primary.reload()
        primary.get_by_text('本机有 1 道题的未同步答案').click()
        expect(primary.locator('.exam-unsubmitted li')).to_have_text('第 7 题 · B')
    finally:
        first.close()
        second.close()
