import os
from pathlib import Path
import re
from time import perf_counter

from playwright.sync_api import expect


FEIYU_AVATAR_PATH = re.compile(r'/ui-images/feiyu\.[a-f0-9]{10}\.webp$')


def send_with_receipt(page, body, path):
    page.get_by_role('textbox', name='聊天消息').fill(body)
    with page.expect_response(lambda r: r.request.method == 'POST' and r.url.split('?')[0].endswith(path)) as sent:
        page.get_by_role('button', name='发送', exact=True).tap()
    response = sent.value
    original_id = response.request.post_data_json['clientId']
    if response.status == 429:
        # The shared and direct chat APIs each allow one message per user per second.
        assert response.json()['error'] == '发得太快了，请稍后再试。'
        failed = page.locator('[data-message-id]').filter(has=page.get_by_text(body, exact=True)).last
        retry = failed.get_by_role('button', name='重发', exact=True)
        expect(retry).to_be_visible()
        page.wait_for_timeout(1000)
        with page.expect_response(lambda r: r.request.method == 'POST' and r.url.split('?')[0].endswith(path)) as resent:
            retry.tap()
        response = resent.value
        assert response.request.post_data_json['clientId'] == original_id
    assert response.ok, (response.status, response.text())
    message = response.json()['message']
    assert message['body'] == body and message['clientId'] == original_id
    return message['id']


def assert_wrapped_message(page, body, message_id):
    row = page.locator(f'[data-message-id="{message_id}"]')
    expect(row.get_by_text(body, exact=True)).to_be_visible(timeout=15_000)
    return row.evaluate("""row => {
        const timeline = row.closest('[role=region]')
        const nickname = row.querySelector('[data-nickname]')
        const bubble = row.querySelector('p[dir=auto]')
        return {
            fits: timeline.scrollWidth <= timeline.clientWidth + 1 &&
                nickname.scrollWidth <= nickname.clientWidth + 1 && bubble.scrollWidth <= bubble.clientWidth + 1,
            lines: bubble.clientHeight / parseFloat(getComputedStyle(bubble).lineHeight),
        }
    }""")


def check_feedback(page, origin, check_study_footer):
    check_study_footer(page)
    page.locator('footer a[href="#feedback"]:visible').click()
    expect(page).to_have_url(origin + '/#feedback')
    heading = page.get_by_role('heading', name='意见反馈')
    expect(heading).to_be_focused()
    expect(page.locator('.community-footer')).to_be_hidden()
    expect(page.locator('article[aria-label=练习题目]')).to_be_hidden()
    form = page.get_by_role('region', name='意见反馈')
    expect(form.get_by_text('紧急情况请联系', exact=False)).to_have_text('紧急情况请联系 QQ 邮箱：1176843521@qq.com')
    expect(form.get_by_role('link', name='1176843521@qq.com')).to_have_attribute('href', 'mailto:1176843521@qq.com')
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

    feedback_api = origin + '/api/feedback'
    body = '希望增加模考历史筛选。'
    message.fill(body)
    page.locator('#site-header a[href="#chat"]').click()
    expect(page.get_by_role('heading', name='聊天区')).to_be_visible()
    expect(page.locator('.community-footer')).to_be_hidden()
    page.get_by_role('link', name=re.compile('返回练习$')).click()
    page.locator('footer a[href="#feedback"]:visible').click()
    expect(message).to_have_value(body)
    expect(lowest).to_be_checked()
    page.reload(wait_until='domcontentloaded')
    expect(message).to_have_value(body)
    expect(lowest).to_be_checked()
    with page.expect_response(feedback_api) as request:
        submit.click()
    assert request.value.status == 503
    assert request.value.request.post_data_json == {'rating': '拉完了', 'message': body}
    expect(form.get_by_role('alert')).to_contain_text('暂时无法提交反馈')
    expect(message).to_have_value(body)
    expect(lowest).to_be_checked()

    pending = []
    page.route(feedback_api, lambda route: pending.append(route))
    message.fill('   ')
    with page.expect_request(feedback_api) as empty:
        submit.click()
    assert empty.value.post_data_json == {'rating': '拉完了', 'message': ''}
    expect(lowest).to_be_disabled()
    expect(message).not_to_be_editable()
    expect(form.get_by_role('button', name='正在提交')).to_be_disabled()
    pending[0].fulfill(json={'sent': True})
    expect(form.get_by_role('status')).to_contain_text('感谢你的反馈，已收到！')
    expect(form.get_by_role('button', name='再写一条')).to_be_visible()
    expect(message).to_have_count(0)
    page.unroute(feedback_api)
    page.get_by_role('link', name='← 返回练习').click()
    expect(page).to_have_url(origin + '/')
    expect(page.locator('article[aria-label=练习题目]')).to_be_visible()
    page.locator('footer a[href="#feedback"]:visible').click()
    expect(message).to_have_value('')
    expect(form.locator('input:checked')).to_have_count(0)
    page.get_by_role('link', name='← 返回练习').click()


def check_chat(browser, mobile_context, origin, host, cookie_name):
    mobile = mobile_context(browser)
    desktop = browser.new_context(viewport={'width': 1280, 'height': 820}, locale='zh-CN')
    desktop.add_cookies([{
        'name': cookie_name, 'value': 'bob', 'domain': host, 'path': '/',
        'secure': True, 'httpOnly': True, 'sameSite': 'Strict',
    }])
    try:
        sender = mobile.new_page()
        sender.goto(origin, wait_until='networkidle')
        entry = sender.locator('footer.community-footer a[href="#chat"]')
        feedback = sender.locator('footer a[href="#feedback"]:visible')
        assert entry.bounding_box()['x'] < feedback.bounding_box()['x']
        entry.tap()
        expect(sender.get_by_role('heading', name='聊天区')).to_be_visible()
        expect(sender.get_by_role('button', name='修改昵称')).to_be_visible()
        expect(sender.get_by_role('region', name='聊天记录')).to_have_text('')
        draft = sender.get_by_role('textbox', name='聊天消息')
        expect(draft).to_have_value('')
        expect(draft).to_have_attribute('placeholder', re.compile('@AI'))
        screenshots = os.getenv('EQB_CHAT_SCREENSHOTS')
        if screenshots:
            target = Path(screenshots)
            target.mkdir(parents=True, exist_ok=True)
            sender.locator('section[aria-labelledby=chat-title]').screenshot(path=target / 'chat-empty.png')
        expect(sender.locator('[aria-label=修改昵称] img')).to_have_js_property('complete', True)
        assert sender.locator('[aria-label=修改昵称] img').evaluate('(image) => image.naturalWidth') == 96
        original_avatar = sender.locator('[aria-label=修改昵称] img').get_attribute('src')
        sender.get_by_role('button', name='修改昵称').tap()
        sender.get_by_label('聊天昵称').fill('刷题小噜噜')
        sender.get_by_role('button', name='保存', exact=True).tap()
        expect(sender.get_by_role('button', name='修改昵称')).to_contain_text('刷题小噜噜')
        sender.reload(wait_until='domcontentloaded')
        expect(sender.get_by_role('button', name='修改昵称')).to_contain_text('刷题小噜噜')
        expect(sender.locator('[aria-label=修改昵称] img')).to_have_attribute('src', original_avatar)

        receiver = desktop.new_page()
        receiver.goto(origin + '/#chat', wait_until='networkidle')
        expect(receiver.get_by_role('button', name='修改昵称')).to_be_visible()
        expect(receiver.get_by_role('region', name='聊天记录')).to_have_text('')
        receiver.get_by_role('link', name=re.compile('返回练习$')).click()
        receiver_entry = receiver.locator('footer.community-footer a[href="#chat"]')
        badge = receiver_entry.locator('span[aria-hidden=true].rounded-full')
        expect(badge).to_have_count(0)
        draft.fill('刷题见面啦 ')
        sender.get_by_role('link', name=re.compile('返回练习$')).tap()
        feedback.tap()
        expect(sender.get_by_role('heading', name='意见反馈')).to_be_visible()
        sender.locator('#site-header a[href="#chat"]').tap()
        expect(draft).to_have_value('刷题见面啦 ')
        sender.reload(wait_until='domcontentloaded')
        expect(draft).to_have_value('刷题见面啦 ')
        draft.evaluate('(input) => { input.focus(); input.setSelectionRange(input.value.length, input.value.length) }')
        sender.get_by_role('button', name='插入表情').tap()
        expect(sender.locator('#chat-emoji-panel')).to_be_visible()
        sender.get_by_role('heading', name='聊天区').tap()
        expect(sender.locator('#chat-emoji-panel')).to_have_count(0)
        sender.get_by_role('button', name='插入表情').tap()
        sender.get_by_role('button', name='🎉', exact=True).tap()
        expect(draft).to_have_value('刷题见面啦 🎉')
        # Chromium does not expose keepalive requests to page.route.
        sender.evaluate('''() => {
          const send = window.fetch.bind(window);
          window.chatSendBodies = [];
          window.fetch = (input, init) => {
            const url = new URL(String(input), location.href);
            if (url.pathname === '/api/chat' && init?.method === 'POST') {
              window.chatSendBodies.push(JSON.parse(init.body));
              if (window.chatSendBodies.length === 1) {
                return new Promise((resolve) => {
                  window.failChatSend = () => resolve(Response.json({ error: '暂时无法发送' }, { status: 503 }));
                });
              }
            }
            return send(input, init);
          };
        }''')
        shown = perf_counter()
        sender.get_by_role('button', name='发送', exact=True).tap()
        expect(sender.locator('[data-message-id][data-mine=true] p[dir=auto]')).to_have_text('刷题见面啦 🎉')
        expect(sender.locator('[data-message-id] :is([role=status],[role=alert])')).to_have_text('发送中…')
        print(f'OPTIMISTIC_CHAT milliseconds_to_bubble={1000 * (perf_counter() - shown):.2f}')
        sender.evaluate('window.failChatSend()')
        expect(sender.locator('[data-message-id] :is([role=status],[role=alert])')).to_contain_text('暂时无法发送')
        sender.get_by_role('button', name='重发', exact=True).tap()
        expect(sender.locator('[data-message-id] :is([role=status],[role=alert])')).to_have_count(0)
        attempts = sender.evaluate('window.chatSendBodies')
        assert len(attempts) == 2 and attempts[0] == attempts[1]
        expect(draft).to_have_value('')
        expect(entry.locator('span[aria-hidden=true].rounded-full')).to_have_count(0)
        receiver.bring_to_front()
        expect(badge).to_be_visible(timeout=18000)
        receiver_entry.click()
        expect(receiver.locator('[data-message-id][data-mine=false] p[dir=auto]')).to_have_text('刷题见面啦 🎉', timeout=12000)
        expect(badge).to_have_count(0)
        expect(receiver.locator('[data-nickname]')).to_have_text('刷题小噜噜')

        reply = receiver.get_by_role('textbox', name='聊天消息')
        reply.fill('收到！')
        reply.press('Shift+Enter')
        reply.type('<b>下课再聊</b>')
        reply.press('Enter')
        expect(receiver.locator('[data-message-id][data-mine=true] p[dir=auto]')).to_have_text(re.compile(r'收到！\s*<b>下课再聊</b>'))
        expect(receiver.locator('p[dir=auto] b')).to_have_count(0)
        sender.bring_to_front()
        expect(sender.locator('[data-message-id][data-mine=false] p[dir=auto]')).to_contain_text('下课再聊', timeout=12000)
        other_nickname = sender.locator('[data-message-id][data-mine=false] [data-nickname]')
        original_other_nickname = other_nickname.inner_text()
        sender.get_by_role('button', name='修改昵称').tap()
        sender.get_by_label('聊天昵称').fill('专注的奶娃')
        sender.get_by_role('button', name='保存', exact=True).tap()
        expect(sender.locator('[data-message-id][data-mine=true] [data-nickname]')).to_have_text('专注的奶娃')
        expect(other_nickname).to_have_text(original_other_nickname)
        expect(sender.locator('[data-message-id][data-mine=true] p[dir=auto]')).to_have_text('刷题见面啦 🎉')
        receiver.bring_to_front()
        expect(receiver.locator('[data-message-id][data-mine=false] [data-nickname]')).to_have_text('专注的奶娃', timeout=12000)
        expect(receiver.locator('[data-message-id]')).to_have_count(2)
        assert sender.evaluate('document.documentElement.scrollWidth <= innerWidth')
        if screenshots:
            sender.locator('section[aria-labelledby=chat-title]').screenshot(path=target / 'chat-mobile.png')
            receiver.locator('section[aria-labelledby=chat-title]').screenshot(path=target / 'chat-desktop.png')
        sender.get_by_role('link', name=re.compile('返回练习$')).tap()
        expect(sender).to_have_url(origin + '/')
        expect(sender.locator('section[aria-labelledby=chat-title]')).to_have_count(0)
        expect(sender.locator('article[aria-label=练习题目] h1')).to_be_visible()
        entry.tap()
        expect(sender.locator('p[dir=auto]').first).to_be_visible(timeout=3000)
        expect(sender.locator('p[dir=auto] > span:text-is("AI 自动")')).to_have_count(0)
        sender.get_by_role('button', name='提及 AI').tap()
        expect(draft).to_have_value('@AI ')
        draft.fill('@AI 真ai吗🤔')
        sender.get_by_role('button', name='发送', exact=True).tap()
        expect(sender.locator('p[dir=auto] > span:text-is("AI 自动")')).to_have_text('AI 自动', timeout=12000)
        badge = sender.get_by_text('AI 自动', exact=True)
        assert badge.evaluate('''label => {
          const css = getComputedStyle(label)
          const luminance = color => color.match(/[0-9.]+/g).slice(0, 3)
            .map(v => Number(v) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
            .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
          const values = [luminance(css.color), luminance(css.backgroundColor)].sort((a, b) => a - b)
          return (values[1] + 0.05) / (values[0] + 0.05) >= 4.5
        }''')
        expect(sender.locator('p[dir=auto]:has(> span:text-is("AI 自动"))')).to_contain_text('真啊，不然我咋从网线里游过来的喵')
        bot = sender.locator('[data-message-id]').filter(has=sender.locator('p[dir=auto]:has(> span:text-is("AI 自动"))'))
        expect(bot.locator('[data-nickname]')).to_have_text('AI（可@）')
        expect(bot.locator('img')).to_have_attribute('src', FEIYU_AVATAR_PATH)
        assert bot.locator('img').evaluate('(image) => image.decode().then(() => image.naturalWidth === 144)')
        if screenshots:
            bot.screenshot(path=target / 'chat-ai-bubble.png')

        sender.get_by_role('button', name='修改昵称').tap()
        long_name = 'W' * 48
        sender.get_by_label('聊天昵称').fill(long_name)
        sender.get_by_role('button', name='保存', exact=True).tap()
        expect(sender.get_by_role('button', name='修改昵称')).to_contain_text(long_name)
        long_url = 'https://example.test/' + 'W' * 479
        long_message_id = send_with_receipt(sender, long_url, '/api/chat')
        assert assert_wrapped_message(sender, long_url, long_message_id)['fits']
        receiver.set_viewport_size({'width': 390, 'height': 844})
        receiver.bring_to_front()
        layout = assert_wrapped_message(receiver, long_url, long_message_id)
        assert layout['fits'] and layout['lines'] > 2
        avatar = receiver.get_by_role('button', name='提及 ' + long_name, exact=True).last
        avatar.hover()
        receiver.mouse.down()
        try:
            expect(reply).to_have_value('@' + long_name + ' ')
        finally:
            receiver.mouse.up()
        expect(reply).to_have_value('@' + long_name + ' ')
        sender.get_by_role('button', name='修改昵称').tap()
        sender.get_by_label('聊天昵称').fill('专注的奶娃')
        sender.get_by_role('button', name='保存', exact=True).tap()
    finally:
        desktop.close()
        mobile.close()


def check_author_chat_history(page, origin):
    library = origin + '/questions'
    page.goto(origin, wait_until='domcontentloaded')
    nav = page.get_by_role('link', name='总题库', exact=True)
    if not nav.count():
        page.get_by_role('button', name='打开练习设置与导航').tap()
    nav.tap()
    expect(page).to_have_url(library)

    feedback = page.locator('footer a[href="#feedback"]:visible')
    author_chat = page.get_by_role('link', name='作者对话')
    back_to_feedback = page.get_by_role('link', name='返回意见反馈')
    back_to_library = page.get_by_role('link', name='← 返回练习')

    feedback.tap()
    author_chat.tap()
    back_to_feedback.tap()
    expect(page).to_have_url(library + '#feedback')
    back_to_library.tap()
    expect(page).to_have_url(library)
    page.go_back()
    expect(page).to_have_url(origin + '/')
    page.go_forward()
    expect(page).to_have_url(library)

    page.go_forward()
    expect(page).to_have_url(library + '#feedback')
    page.go_forward()
    expect(page).to_have_url(library + '#author-chat')
    page.go_back()
    expect(author_chat).to_be_visible()
    back_to_library.tap()

    # A direct link has no recorded parent and must keep its query when closed.
    direct = library + '?navigation=direct'
    page.goto(direct + '#author-chat', wait_until='domcontentloaded')
    back_to_feedback.tap()
    expect(page).to_have_url(direct + '#feedback')
    back_to_library.tap()
    expect(page).to_have_url(direct)
    page.go_back()
    expect(page).to_have_url(library)


def check_author_chat(browser, mobile_context, origin, host, cookie_name):
    student = mobile_context(browser)
    owner = browser.new_context(viewport={'width': 1280, 'height': 820}, locale='zh-CN', color_scheme='dark')
    owner.add_cookies([{
        'name': cookie_name, 'value': 'author', 'domain': host, 'path': '/',
        'secure': True, 'httpOnly': True, 'sameSite': 'Strict',
    }])
    try:
        guest = student.new_page()
        guest.goto(origin + '/#author-chat', wait_until='domcontentloaded')
        expect(guest.get_by_text('请从意见反馈打开作者对话。')).to_be_visible()
        expect(guest.locator('p[dir=auto]')).to_have_count(0)
        guest.get_by_role('link', name='返回意见反馈').tap()
        contact = guest.get_by_role('link', name='作者对话')
        expect(contact).to_be_visible()
        composer = guest.get_by_role('textbox', name='聊天消息')
        contact.tap()
        expect(guest.get_by_role('heading', name='作者对话')).to_be_focused()
        expect(guest.get_by_role('button', name='修改昵称')).to_have_count(0)
        greet = guest.locator('p[dir=auto]').get_by_text('你好，感谢使用，欢迎分享，请问有什么问题吗？')
        expect(greet).to_be_visible()
        expect(guest.locator('[aria-label=对话对象]')).to_have_text('Hua Xiaowei')
        expect(guest.locator('[aria-label=对话对象] img')).to_have_attribute('src', re.compile(r'^data:image/webp;base64,'))

        composer.fill('作者对话草稿')
        guest.get_by_role('link', name='返回意见反馈').tap()
        guest.locator('#site-header a[href="#chat"]').tap()
        expect(composer).to_have_value('')
        guest.get_by_role('link', name=re.compile('返回练习$')).tap()
        guest.locator('footer a[href="#feedback"]:visible').tap()
        contact.tap()
        expect(composer).to_have_value('作者对话草稿')
        composer.fill('')
        avatar = guest.get_by_role('button', name='提及 Hua Xiaowei')
        box = avatar.bounding_box()
        assert box
        cdp = student.new_cdp_session(guest)
        cdp.send('Input.dispatchTouchEvent', {
            'type': 'touchStart', 'touchPoints': [{'x': box['x'] + box['width'] / 2, 'y': box['y'] + box['height'] / 2}],
        })
        expect(composer).to_have_value('@Hua Xiaowei ', timeout=3000)
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        expect(composer).to_have_value('@Hua Xiaowei ')
        composer.fill('作者你好，这是浏览器测试。')
        guest.get_by_role('button', name='发送', exact=True).tap()
        expect(guest.locator('[data-message-id][data-mine=true] p[dir=auto]')).to_have_text('作者你好，这是浏览器测试。')
        expect(composer).to_have_value('')
        guest.get_by_role('link', name='返回意见反馈').tap()
        expect(contact).to_be_visible()
        guest.get_by_role('link', name='← 返回练习').tap()
        expect(guest).to_have_url(origin + '/')

        history_page = student.new_page()
        check_author_chat_history(history_page, origin)
        history_page.close()

        inbox = owner.new_page()
        inbox.goto(origin + '/#chat', wait_until='domcontentloaded')
        owner_profile = inbox.locator('header [title="AI（可@）"]')
        expect(owner_profile).to_have_text('AI（可@）')
        expect(owner_profile.locator('img')).to_have_attribute('src', FEIYU_AVATAR_PATH)
        expect(inbox.get_by_role('button', name='修改昵称')).to_have_count(0)
        inbox.goto(origin + '/#feedback', wait_until='domcontentloaded')
        inbox.get_by_role('link', name='作者对话').click()
        expect(inbox.get_by_role('heading', name='作者对话')).to_have_count(1)
        new_contact = inbox.get_by_role('link', name=re.compile(r'alice@example\.test'))
        expect(new_contact).to_contain_text('暂无消息')
        new_contact.click()
        expect(inbox.locator('[aria-label=对话对象] small')).to_have_text('alice@example.test')
        expect(inbox.locator('p[dir=auto]')).to_have_count(0)
        thread_url = inbox.url
        inbox.go_back()
        expect(inbox).to_have_url(origin + '/#author-chat')
        inbox.go_forward()
        expect(inbox).to_have_url(thread_url)
        inbox.get_by_role('link', name='返回会话列表').click()
        expect(inbox).to_have_url(origin + '/#author-chat')
        inbox.get_by_role('button', name='仅看未读').click()
        search = inbox.get_by_role('searchbox', name='搜索会话')
        search.fill('不存在的邮箱')
        expect(inbox.get_by_text('没有匹配的联系人')).to_be_visible()
        search.fill('BROWSER@')
        row = inbox.get_by_role('link', name=re.compile(r'browser@example\.test'))
        expect(row).to_contain_text('作者你好，这是浏览器测试。')
        expect(row.locator('span[aria-hidden=true].rounded-full')).to_have_count(1)
        screenshots = os.getenv('EQB_CHAT_SCREENSHOTS')
        if screenshots:
            target = Path(screenshots)
            inbox.locator('section[aria-labelledby=chat-title]').screenshot(path=target / 'author-inbox-dark.png')
        row.click()
        expect(inbox.locator('[aria-label=对话对象] small')).to_have_text('browser@example.test')
        inbox.get_by_role('textbox', name='聊天消息').fill('谢谢你的反馈，我看到了。')
        inbox.get_by_role('button', name='发送', exact=True).click()
        expect(inbox.locator('p[dir=auto]').last).to_have_text('谢谢你的反馈，我看到了。')
        inbox.get_by_role('link', name='返回会话列表').click()
        expect(inbox.get_by_role('button', name='仅看未读')).to_have_attribute('aria-pressed', 'true')
        expect(search).to_have_value('BROWSER@')
        expect(inbox.get_by_text('没有匹配的联系人')).to_be_visible()
        search.fill('')
        expect(inbox.get_by_text('没有未读会话')).to_be_visible()

        guest.bring_to_front()
        feedback = guest.locator('footer a[href="#feedback"]:visible')
        expect(feedback.locator('span[aria-hidden=true].rounded-full')).to_be_visible(timeout=17000)
        feedback.tap()
        expect(contact.locator('span[aria-hidden=true].rounded-full')).to_be_visible()
        if screenshots:
            guest.locator('[aria-labelledby=feedback-title]').screenshot(path=target / 'feedback-with-unread.png')
        contact.tap()
        expect(guest.locator('p[dir=auto]').last).to_have_text('谢谢你的反馈，我看到了。')
        expect(feedback.locator('span[aria-hidden=true].rounded-full')).to_have_count(0)
        expect(greet).to_have_count(1)
        if screenshots:
            guest.locator('section[aria-labelledby=chat-title]').screenshot(path=target / 'author-thread-mobile.png')
        assert guest.evaluate('document.documentElement.scrollWidth <= innerWidth')
        guest.get_by_role('link', name='返回意见反馈').tap()
        expect(contact.locator('span[aria-hidden=true].rounded-full')).to_have_count(0)
        contact.tap()
        composer.fill('@作者 真ai吗🤔')
        guest.get_by_role('button', name='发送', exact=True).tap()
        expect(guest.locator('p[dir=auto] > span:text-is("AI 自动")')).to_have_text('AI 自动', timeout=12000)
        expect(guest.locator('p[dir=auto]:has(> span:text-is("AI 自动"))')).to_contain_text('真啊，不然我咋从网线里游过来的喵')

        private_url = 'https://example.test/' + 'X' * 479
        private_message_id = send_with_receipt(guest, private_url, '/api/author-chat')
        assert assert_wrapped_message(guest, private_url, private_message_id)['fits']
        inbox.bring_to_front()
        inbox.get_by_role('button', name='全部', exact=True).click()
        search.fill('browser@example.test')
        inbox.get_by_role('link', name=re.compile(r'browser@example\.test')).click()
        inbox.set_viewport_size({'width': 390, 'height': 844})
        layout = assert_wrapped_message(inbox, private_url, private_message_id)
        assert layout['fits'] and layout['lines'] > 2
    finally:
        owner.close()
        student.close()
