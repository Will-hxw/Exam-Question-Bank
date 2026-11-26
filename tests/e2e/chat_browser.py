import os
from pathlib import Path
import re

from playwright.sync_api import expect


def check_feedback(page, origin, check_study_footer):
    check_study_footer(page)
    page.get_by_role('link', name='打开意见反馈页面').click()
    expect(page).to_have_url(origin + '/#feedback')
    heading = page.get_by_role('heading', name='意见反馈')
    expect(heading).to_be_focused()
    expect(page.locator('.question-card')).to_be_hidden()
    form = page.get_by_role('region', name='意见反馈')
    expect(form.locator('.feedback-contact')).to_have_text('紧急情况请联系 QQ 邮箱：1176843521@qq.com')
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
    with page.expect_response(feedback_api) as request:
        submit.click()
    assert request.value.status == 503
    assert request.value.request.post_data_json == {'rating': '拉完了', 'message': body}
    expect(form.get_by_role('alert')).to_contain_text('暂时无法提交反馈')
    expect(message).to_have_value(body)
    expect(lowest).to_be_checked()

    page.route(feedback_api, lambda route: route.fulfill(json={'sent': True}))
    message.fill('   ')
    with page.expect_request(feedback_api) as empty:
        submit.click()
    assert empty.value.post_data_json == {'rating': '拉完了', 'message': ''}
    expect(form.get_by_role('status')).to_have_text('反馈已提交，感谢你的建议！')
    expect(message).to_have_count(0)
    page.unroute(feedback_api)
    page.get_by_role('link', name='← 返回练习').click()
    expect(page).to_have_url(origin + '/')
    expect(page.locator('.question-card')).to_be_visible()


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
        entry = sender.get_by_role('link', name='打开聊天区')
        feedback = sender.get_by_role('link', name='打开意见反馈页面')
        assert entry.bounding_box()['x'] < feedback.bounding_box()['x']
        entry.tap()
        expect(sender.get_by_role('heading', name='聊天区')).to_be_visible()
        expect(sender.get_by_role('button', name='修改昵称')).to_be_visible()
        expect(sender.get_by_role('region', name='聊天记录')).to_have_text('')
        draft = sender.get_by_role('textbox', name='聊天消息')
        expect(draft).to_have_value('')
        assert draft.get_attribute('placeholder') is None
        screenshots = os.getenv('EQB_CHAT_SCREENSHOTS')
        if screenshots:
            target = Path(screenshots)
            target.mkdir(parents=True, exist_ok=True)
            sender.locator('.chat-room').screenshot(path=target / 'chat-empty.png')
        expect(sender.locator('.chat-profile img')).to_have_js_property('complete', True)
        assert sender.locator('.chat-profile img').evaluate('(image) => image.naturalWidth') == 96
        original_avatar = sender.locator('.chat-profile img').get_attribute('src')
        sender.get_by_role('button', name='修改昵称').tap()
        sender.get_by_label('聊天昵称').fill('刷题小噜噜')
        sender.get_by_role('button', name='保存', exact=True).tap()
        expect(sender.get_by_role('button', name='修改昵称')).to_contain_text('刷题小噜噜')
        sender.reload(wait_until='domcontentloaded')
        expect(sender.get_by_role('button', name='修改昵称')).to_contain_text('刷题小噜噜')
        expect(sender.locator('.chat-profile img')).to_have_attribute('src', original_avatar)

        receiver = desktop.new_page()
        receiver.goto(origin + '/#chat', wait_until='networkidle')
        expect(receiver.get_by_role('button', name='修改昵称')).to_be_visible()
        expect(receiver.get_by_role('region', name='聊天记录')).to_have_text('')
        receiver.get_by_role('link', name='返回练习', exact=True).click()
        receiver_entry = receiver.get_by_role('link', name='打开聊天区')
        badge = receiver_entry.locator('.message-unread-dot')
        expect(badge).to_have_count(0)
        draft.fill('刷题见面啦 ')
        sender.get_by_role('button', name='插入表情').tap()
        expect(sender.locator('#chat-emoji-panel')).to_be_visible()
        sender.get_by_role('heading', name='聊天区').tap()
        expect(sender.locator('#chat-emoji-panel')).to_have_count(0)
        sender.get_by_role('button', name='插入表情').tap()
        sender.get_by_role('button', name='🎉', exact=True).tap()
        expect(draft).to_have_value('刷题见面啦 🎉')
        sender.get_by_role('button', name='发送', exact=True).tap()
        expect(sender.locator('.is-mine .chat-bubble')).to_have_text('刷题见面啦 🎉')
        expect(entry.locator('.message-unread-dot')).to_have_count(0)
        receiver.bring_to_front()
        expect(badge).to_be_visible(timeout=18000)
        receiver_entry.click()
        expect(receiver.locator('.chat-message-row:not(.is-mine) .chat-bubble')).to_have_text('刷题见面啦 🎉', timeout=12000)
        expect(badge).to_have_count(0)
        expect(receiver.locator('.chat-nickname')).to_have_text('刷题小噜噜')

        reply = receiver.get_by_role('textbox', name='聊天消息')
        reply.fill('收到！')
        reply.press('Shift+Enter')
        reply.type('<b>下课再聊</b>')
        reply.press('Enter')
        expect(receiver.locator('.is-mine .chat-bubble')).to_have_text(re.compile(r'收到！\s*<b>下课再聊</b>'))
        expect(receiver.locator('.chat-bubble b')).to_have_count(0)
        sender.bring_to_front()
        expect(sender.locator('.chat-message-row:not(.is-mine) .chat-bubble')).to_contain_text('下课再聊', timeout=12000)
        other_nickname = sender.locator('.chat-message-row:not(.is-mine) .chat-nickname')
        original_other_nickname = other_nickname.inner_text()
        sender.get_by_role('button', name='修改昵称').tap()
        sender.get_by_label('聊天昵称').fill('专注的奶娃')
        sender.get_by_role('button', name='保存', exact=True).tap()
        expect(sender.locator('.is-mine .chat-nickname')).to_have_text('专注的奶娃')
        expect(other_nickname).to_have_text(original_other_nickname)
        expect(sender.locator('.is-mine .chat-bubble')).to_have_text('刷题见面啦 🎉')
        receiver.bring_to_front()
        expect(receiver.locator('.chat-message-row:not(.is-mine) .chat-nickname')).to_have_text('专注的奶娃', timeout=12000)
        expect(receiver.locator('.chat-message-row')).to_have_count(2)
        assert sender.evaluate('document.documentElement.scrollWidth <= innerWidth')
        if screenshots:
            sender.locator('.chat-room').screenshot(path=target / 'chat-mobile.png')
            receiver.locator('.chat-room').screenshot(path=target / 'chat-desktop.png')
        sender.get_by_role('link', name='返回练习', exact=True).tap()
        expect(sender).to_have_url(origin + '/')
        expect(sender.locator('.chat-room')).to_have_count(0)
        expect(sender.locator('.question-card .q-text')).to_be_visible()
        entry.tap()
        expect(sender.locator('.chat-bubble').first).to_be_visible(timeout=3000)
    finally:
        desktop.close()
        mobile.close()


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
        expect(guest.locator('.chat-bubble')).to_have_count(0)
        guest.get_by_role('link', name='返回意见反馈').tap()
        contact = guest.get_by_role('link', name='作者对话')
        expect(contact).to_be_visible()
        composer = guest.get_by_role('textbox', name='聊天消息')
        contact.tap()
        expect(guest.get_by_role('heading', name='作者对话')).to_be_focused()
        expect(guest.get_by_role('button', name='修改昵称')).to_have_count(0)
        greet = guest.locator('.chat-bubble').get_by_text('你好，感谢使用，欢迎分享，请问有什么问题吗？')
        expect(greet).to_be_visible()
        expect(guest.locator('.chat-counterpart')).to_have_text('Hua Xiaowei')
        expect(guest.locator('.chat-counterpart img')).to_have_attribute('src', re.compile(r'^data:image/webp;base64,'))

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
        expect(guest.locator('.is-mine .chat-bubble')).to_have_text('作者你好，这是浏览器测试。')
        guest.get_by_role('link', name='返回意见反馈').tap()
        expect(contact).to_be_visible()
        guest.get_by_role('link', name='← 返回练习').tap()
        expect(guest).to_have_url(origin + '/')

        inbox = owner.new_page()
        inbox.goto(origin + '/#feedback', wait_until='domcontentloaded')
        inbox.get_by_role('link', name='作者对话').click()
        expect(inbox.get_by_role('heading', name='作者对话')).to_have_count(1)
        inbox.get_by_role('button', name='仅看未读').click()
        search = inbox.get_by_role('searchbox', name='搜索会话')
        search.fill('不存在的邮箱')
        expect(inbox.get_by_text('没有匹配的会话')).to_be_visible()
        search.fill('BROWSER@')
        row = inbox.get_by_role('link', name=re.compile(r'browser@example\.test'))
        expect(row).to_contain_text('作者你好，这是浏览器测试。')
        expect(row.locator('.message-unread-dot')).to_have_count(1)
        screenshots = os.getenv('EQB_CHAT_SCREENSHOTS')
        if screenshots:
            target = Path(screenshots)
            inbox.locator('.chat-room').screenshot(path=target / 'author-inbox-dark.png')
        row.click()
        expect(inbox.locator('.chat-counterpart small')).to_have_text('browser@example.test')
        inbox.get_by_role('textbox', name='聊天消息').fill('谢谢你的反馈，我看到了。')
        inbox.get_by_role('button', name='发送', exact=True).click()
        expect(inbox.locator('.chat-bubble').last).to_have_text('谢谢你的反馈，我看到了。')
        inbox.get_by_role('link', name='返回会话列表').click()
        expect(inbox.get_by_role('button', name='仅看未读')).to_have_attribute('aria-pressed', 'true')
        expect(search).to_have_value('BROWSER@')
        expect(inbox.get_by_text('没有匹配的会话')).to_be_visible()
        search.fill('')
        expect(inbox.get_by_text('没有未读会话')).to_be_visible()

        guest.bring_to_front()
        feedback = guest.get_by_role('link', name='打开意见反馈页面')
        expect(feedback.locator('.message-unread-dot')).to_be_visible(timeout=17000)
        feedback.tap()
        expect(contact.locator('.message-unread-dot')).to_be_visible()
        if screenshots:
            guest.locator('.feedback-page').screenshot(path=target / 'feedback-with-unread.png')
        contact.tap()
        expect(guest.locator('.chat-bubble').last).to_have_text('谢谢你的反馈，我看到了。')
        expect(feedback.locator('.message-unread-dot')).to_have_count(0)
        expect(greet).to_have_count(1)
        if screenshots:
            guest.locator('.chat-room').screenshot(path=target / 'author-thread-mobile.png')
        assert guest.evaluate('document.documentElement.scrollWidth <= innerWidth')
        guest.get_by_role('link', name='返回意见反馈').tap()
        expect(contact.locator('.message-unread-dot')).to_have_count(0)
    finally:
        owner.close()
        student.close()
