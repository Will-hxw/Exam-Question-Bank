import re
from uuid import uuid4

from playwright.sync_api import expect


def check_undone_practice(browser, origin, host, cookie_name):
    user = 'e2e-undone'
    topic = 't01'
    pref = 'practice-only-undone'
    headers = {'Cookie': f'{cookie_name}=undone', 'Origin': origin, 'X-Study-Account': user}

    def open_context():
        context = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        context.add_cookies([{'name': cookie_name, 'value': 'undone', 'domain': host, 'path': '/',
                              'secure': True, 'httpOnly': True, 'sameSite': 'Strict'}])
        return context

    context = open_context()
    try:
        page = context.new_page()
        bank = origin + '/api/public/questions?mode=practice&limit=50'
        topic_questions = page.request.get(bank + f'&topic={topic}').json()['questions']
        all_questions = page.request.get(bank).json()['questions']
        attempted = [topic_questions[index] for index in (0, 1, 12, 13, 14, 15, 16, -1)]
        attempt_url = origin + '/api/attempts/batch'

        def attempt(questions):
            events = [
                {'mode': 'practice', 'eventId': str(uuid4()), 'questionId': item['id'],
                 'optionIds': [next(option['id'] for option in item['options'] if option['id'] not in item['answerIds'])],
                 **({'contentRevision': item['contentRevision']} if item.get('contentRevision') else {})}
                for item in questions
            ]
            reply = page.request.post(attempt_url, headers=headers, data={'ownerId': user, 'events': events})
            assert reply.ok and all(item['status'] == 'saved' for item in reply.json()['results']), reply.text()

        attempt(attempted)
        favorite = attempted[0]
        assert page.request.put(origin + '/api/me/favorites/' + favorite['id'], headers=headers, data={'favorite': True}).ok
        preferences_url = origin + '/api/me/preferences'
        assert page.request.put(preferences_url, headers=headers, data={'practice': {'mode': 'topic', 'topic': topic}}).ok
        page.goto(origin + '/', wait_until='domcontentloaded')
        article = page.get_by_role('article', name='练习题目')
        stem = article.get_by_role('heading', level=1)
        drawer = page.get_by_role('dialog')

        def open_settings():
            page.get_by_role('button', name='打开练习设置与导航').tap()
            expect(drawer).to_be_visible()

        def close_settings():
            drawer.get_by_role('button', name='完成', exact=True).tap()
            expect(drawer).not_to_be_visible()

        def change_mode(name):
            open_settings()
            target = drawer.get_by_role('button', name=name, exact=True)
            target.tap()
            expect(target).to_have_attribute('aria-pressed', 'true')
            close_settings()

        def switch_filter(enabled=None):
            open_settings()
            switch = drawer.get_by_role('button', name='只刷未做', exact=True)
            switch.tap()
            if enabled is not None:
                expect(switch).to_have_attribute('aria-pressed', str(enabled).lower())
            close_settings()

        def check_filter(enabled):
            open_settings()
            expect(drawer.get_by_role('button', name='只刷未做')).to_have_attribute('aria-pressed', str(enabled).lower())
            close_settings()

        def jump(number):
            page.get_by_role('button', name='答题卡', exact=True).tap()
            drawer.get_by_role('spinbutton', name='跳转题号').fill(str(number))
            drawer.get_by_role('button', name='跳转', exact=True).tap()

        expect(stem).to_have_text(favorite['stem'])
        open_settings()
        assert drawer.locator('button[aria-pressed]').all_text_contents() == ['专题', '随机', '顺序', '只刷未做', '错题', '收藏']
        expect(drawer.get_by_role('button', name='只刷未做')).to_have_attribute('aria-pressed', 'false')
        close_settings()
        page.get_by_role('button', name='下一题', exact=True).tap()
        expect(stem).to_have_text(topic_questions[1]['stem'])
        page.get_by_role('button', name='上一题', exact=True).tap()
        expect(stem).to_have_text(topic_questions[0]['stem'])
        with page.expect_response(lambda r: r.url == preferences_url and r.request.post_data_json.get(pref) is True) as saved:
            switch_filter()
        assert saved.value.ok
        check_filter(True)
        open_settings()
        active_color = drawer.get_by_role('button', name='专题', exact=True).evaluate('(el) => getComputedStyle(el).backgroundColor')
        expect(drawer.get_by_role('button', name='只刷未做')).to_have_css('background-color', active_color)
        close_settings()
        expect(stem).to_have_text(topic_questions[2]['stem'])
        switch_filter()
        check_filter(False)
        page.get_by_role('button', name='上一题', exact=True).tap()
        expect(stem).to_have_text(topic_questions[1]['stem'])
        page.reload(wait_until='domcontentloaded')
        expect(stem).to_have_text(topic_questions[1]['stem'])
        page.get_by_role('button', name='下一题', exact=True).tap()
        expect(stem).to_have_text(topic_questions[2]['stem'])
        switch_filter()
        check_filter(True)
        jump(14)
        expect(stem).to_have_text(topic_questions[13]['stem'])
        blocked = ('**/api/me/practice-undone*', '**/api/me/question-state?*')
        for pattern in blocked:
            page.route(pattern, lambda route: route.abort())
        page.get_by_role('button', name='下一题', exact=True).tap()
        expect(stem).to_have_text(topic_questions[17]['stem'])
        expect(article).to_contain_text(re.compile(r'18\s*/'))
        for pattern in blocked:
            page.unroute(pattern)
        switch_filter()
        page.get_by_role('button', name='上一题', exact=True).tap()
        expect(stem).to_have_text(topic_questions[13]['stem'])
        switch_filter()
        expect(stem).to_have_text(topic_questions[17]['stem'])
        jump(len(topic_questions))
        expect(stem).to_have_text(topic_questions[-1]['stem'])
        page.get_by_role('button', name='下一题', exact=True).tap()
        expect(stem).to_have_text(topic_questions[2]['stem'])

        jump(3)
        expect(stem).to_have_text(topic_questions[2]['stem'])
        pending = []
        page.route(attempt_url, lambda route: pending.append(route), times=1)
        with page.expect_request(attempt_url):
            article.get_by_role('group', name='选择答案').get_by_role('button').first.tap()
            if topic_questions[2]['type'] == 'multiple':
                page.get_by_role('button', name='确认提交', exact=True).tap()
        expect(article.get_by_text('已答', exact=True)).to_be_visible()
        jump(2)
        expect(stem).to_have_text(topic_questions[1]['stem'])
        page.get_by_role('button', name='下一题', exact=True).tap()
        expect(stem).to_have_text(topic_questions[3]['stem'])
        with page.expect_response(attempt_url) as synced:
            pending[0].continue_()
        assert synced.value.ok
        attempted.append(topic_questions[2])

        change_mode('顺序')
        check_filter(True)
        completed = {item['id'] for item in attempted}
        anchor = next(index for index, item in enumerate(all_questions) if item['id'] in completed)
        target = next(item for item in all_questions[anchor + 1:] + all_questions[:anchor] if item['id'] not in completed)
        jump(anchor + 1)
        expect(stem).to_have_text(all_questions[anchor]['stem'])
        page.get_by_role('button', name='下一题', exact=True).tap()
        expect(stem).to_have_text(target['stem'])

        change_mode('随机')
        check_filter(True)
        expect(stem).to_be_visible()
        completed_stems = {item['stem'] for item in attempted}
        assert stem.inner_text() not in completed_stems
        before = stem.inner_text()
        page.get_by_role('button', name='下一题', exact=True).tap()
        expect(stem).not_to_have_text(before)
        assert stem.inner_text() not in completed_stems

        change_mode('错题')
        expect(stem).to_be_visible()
        wrong = stem.inner_text()
        switch_filter()
        check_filter(False)
        expect(stem).to_have_text(wrong)
        change_mode('收藏')
        expect(stem).to_have_text(favorite['stem'])
        with page.expect_response(lambda r: r.url == preferences_url and r.request.post_data_json.get(pref) is True):
            switch_filter()
        expect(stem).to_have_text(favorite['stem'])

        remaining = [item for item in topic_questions if item['id'] not in completed]
        last = remaining[-1]
        attempt(remaining[:-1])
        # This is the first visit to the last unanswered question, rather than a manual jump from an existing card.
        position = topic_questions.index(last)
        assert page.request.put(preferences_url, headers=headers, data={
            'practice': {'mode': 'topic', 'topic': topic}, f'practice-position:topic:{topic}': position,
        }).ok
        page.evaluate("key => localStorage.removeItem(key)", f'cqu-practice-history:{user}:topic:{topic}')
        page.reload(wait_until='domcontentloaded')
        check_filter(True)
        expect(stem).to_have_text(last['stem'])
        with page.expect_response(attempt_url) as submitted:
            article.get_by_role('group', name='选择答案').get_by_role('button').first.tap()
            if last['type'] == 'multiple':
                page.get_by_role('button', name='确认提交', exact=True).tap()
        assert submitted.value.ok
        expect(stem).to_have_text(last['stem'])
        expect(article.get_by_role('button', name='重做本题')).to_be_visible()
        expect(page.get_by_role('button', name='下一题', exact=True)).to_be_disabled()
        expect(page.get_by_text('这个范围的题都做过了。')).to_be_visible()
        page.reload(wait_until='domcontentloaded')
        expect(page.get_by_text('这个范围没有未做题。')).to_be_visible()
        jump(1)
        expect(stem).to_have_text(topic_questions[0]['stem'])
        expect(page.get_by_role('button', name='下一题', exact=True)).to_be_disabled()
        expect(page.get_by_text('这个范围的题都做过了。')).to_be_visible()
    finally:
        context.close()
