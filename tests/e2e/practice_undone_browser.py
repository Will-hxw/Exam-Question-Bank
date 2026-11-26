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
    second = None
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
        modes = page.get_by_role('group', name='练习模式')
        switch = modes.get_by_role('button', name='只刷未做')
        stem = page.locator('.question-card .q-text')

        def change_mode(name):
            modes.get_by_role('button', name=name, exact=True).tap()
            expect(modes.get_by_role('button', name=name, exact=True)).to_have_attribute('aria-pressed', 'true')

        def jump(number):
            page.get_by_role('button', name='跳转', exact=True).tap()
            page.get_by_role('spinbutton', name='题号').fill(str(number))
            page.get_by_role('button', name='前往', exact=True).tap()

        expect(stem).to_have_text(favorite['stem'])
        assert modes.get_by_role('button').all_text_contents() == ['专题', '随机', '顺序', '只刷未做', '错题', '收藏']
        expect(switch).to_have_attribute('aria-pressed', 'false')
        with page.expect_response(lambda r: r.url == preferences_url and r.request.post_data_json.get(pref) is True) as saved:
            switch.tap()
        assert saved.value.ok
        expect(switch).to_have_attribute('aria-pressed', 'true')
        active_color = modes.get_by_role('button', name='专题', exact=True).evaluate('(el) => getComputedStyle(el).backgroundColor')
        expect(switch).to_have_css('background-color', active_color)
        expect(stem).to_have_text(topic_questions[2]['stem'])
        jump(14)
        expect(stem).to_have_text(topic_questions[13]['stem'])
        page.get_by_role('button', name='下一题', exact=True).tap()
        expect(stem).to_have_text(topic_questions[17]['stem'])
        expect(page.locator('.progress-info')).to_contain_text('第 18')
        jump(len(topic_questions))
        expect(stem).to_have_text(topic_questions[-1]['stem'])
        page.get_by_role('button', name='下一题', exact=True).tap()
        expect(stem).to_have_text(topic_questions[2]['stem'])

        jump(3)
        expect(stem).to_have_text(topic_questions[2]['stem'])
        pending = []
        page.route(attempt_url, lambda route: pending.append(route), times=1)
        with page.expect_request(attempt_url):
            page.locator('.question-card .option').first.tap()
            if topic_questions[2]['type'] == 'multiple':
                page.get_by_role('button', name='确定', exact=True).tap()
        expect(page.locator('.done-badge')).to_be_visible()
        jump(2)
        expect(stem).to_have_text(topic_questions[1]['stem'])
        page.get_by_role('button', name='下一题', exact=True).tap()
        expect(stem).to_have_text(topic_questions[3]['stem'])
        with page.expect_response(attempt_url) as synced:
            pending[0].continue_()
        assert synced.value.ok
        attempted.append(topic_questions[2])

        change_mode('顺序')
        expect(switch).to_have_attribute('aria-pressed', 'true')
        completed = {item['id'] for item in attempted}
        anchor = next(index for index, item in enumerate(all_questions) if item['id'] in completed)
        target = next(item for item in all_questions[anchor + 1:] + all_questions[:anchor] if item['id'] not in completed)
        jump(anchor + 1)
        expect(stem).to_have_text(all_questions[anchor]['stem'])
        page.get_by_role('button', name='下一题', exact=True).tap()
        expect(stem).to_have_text(target['stem'])

        change_mode('随机')
        expect(switch).to_have_attribute('aria-pressed', 'true')
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
        switch.tap()
        expect(switch).to_have_attribute('aria-pressed', 'false')
        expect(stem).to_have_text(wrong)
        change_mode('收藏')
        expect(stem).to_have_text(favorite['stem'])
        with page.expect_response(lambda r: r.url == preferences_url and r.request.post_data_json.get(pref) is True):
            switch.tap()
        expect(stem).to_have_text(favorite['stem'])

        attempt([item for item in topic_questions if item['id'] not in completed])
        second = open_context()
        elsewhere = second.new_page()
        elsewhere.goto(origin + '/', wait_until='domcontentloaded')
        expect(elsewhere.get_by_role('button', name='只刷未做')).to_have_attribute('aria-pressed', 'true')
        elsewhere.get_by_role('group', name='练习模式').get_by_role('button', name='专题', exact=True).tap()
        expect(elsewhere.get_by_text('这个范围没有未做题。')).to_be_visible()
        elsewhere.get_by_role('button', name='跳转', exact=True).tap()
        elsewhere.get_by_role('spinbutton', name='题号').fill('1')
        elsewhere.get_by_role('button', name='前往', exact=True).tap()
        expect(elsewhere.locator('.question-card .q-text')).to_have_text(topic_questions[0]['stem'])
        elsewhere.get_by_role('button', name='下一题', exact=True).tap()
        expect(elsewhere.get_by_text('这个范围的题都做过了。')).to_be_visible()
    finally:
        if second:
            second.close()
        context.close()
