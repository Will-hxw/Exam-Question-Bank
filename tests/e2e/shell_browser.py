import os
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright


def check_shell(browser, origin, cookie_name, width=440, height=956):
    """Exercise the account, shared navigation, footer and mobile dialog against a local fixture."""
    hostname = urlsplit(origin).hostname
    assert hostname in ('localhost', '127.0.0.1')
    mobile = width < 1024
    context = browser.new_context(viewport={'width': width, 'height': height}, has_touch=mobile,
                                  is_mobile=mobile, device_scale_factor=1, locale='zh-CN',
                                  ignore_https_errors=origin.startswith('https://'), service_workers='block')
    page = context.new_page()
    try:
        page.goto(origin + '/login')
        expect(page.get_by_role('button', name='继续', exact=True)).to_be_enabled()
        credit = page.locator('footer[lang=en]')
        expect(credit).to_have_text('Hua Xiaowei — ZJU')
        assert 'Times New Roman' in credit.evaluate('e => getComputedStyle(e).fontFamily')
        assert credit.evaluate('e => parseFloat(getComputedStyle(e).fontSize)') >= 16
        eye = page.get_by_role('button', name='显示密码')
        expect(eye).to_have_css('background-color', 'rgba(0, 0, 0, 0)')
        eye.click()
        expect(page.locator('#auth-password')).to_have_attribute('type', 'text')
        page.get_by_role('button', name='隐藏密码').click()
        expect(page.locator('#auth-password')).to_have_attribute('type', 'password')
        for name, heading in [('忘记密码', '找回密码'), ('注册', '创建账号')]:
            link = page.get_by_role('button', name=name, exact=True)
            expect(link).to_have_css('text-decoration-line', 'underline')
            link.press('Enter')
            expect(page.get_by_role('heading', name=heading)).to_be_visible()
            page.get_by_role('button', name='返回登录').click()
        page.get_by_role('button', name='显示密码').focus()
        page.keyboard.press('Tab')
        submit = page.get_by_role('button', name='继续', exact=True)
        expect(submit).to_be_focused()
        expect(submit).to_have_css('outline-width', '2px')
        expect(submit).to_have_css('outline-style', 'solid')
        expect(submit).not_to_have_css('outline-color', 'rgba(0, 0, 0, 0)')

        context.add_cookies([{'name': cookie_name, 'value': 'alice', 'domain': hostname, 'path': '/',
                              'secure': True, 'httpOnly': True, 'sameSite': 'Strict'}])
        page.goto(origin + '/questions')
        brand = page.locator('header a[href*="12371.cn"]')
        expect(brand).to_be_visible()
        expect(brand).to_have_accessible_name('重庆大学入党积极分子练习')
        navigation = page.get_by_role('navigation', name='学习导航')
        for name, route in [('错题集', '/wrong'), ('收藏夹', '/favorites'), ('模拟考试', '/exam'),
                            ('总题库', '/questions'), ('刷题', '/')]:
            tab = navigation.get_by_role('link', name=name, exact=True)
            tab.click()
            expect(page).to_have_url(origin + route)
            expect(tab).to_have_attribute('aria-current', 'page')
        if mobile:
            trigger = page.get_by_role('button', name='打开练习设置与导航')
            trigger.click()
            drawer = page.get_by_role('dialog', name='练习设置')
            expect(drawer).to_be_visible()
            page.keyboard.press('Tab')
            expect(drawer.locator(':focus')).to_have_count(1)
            page.keyboard.press('Escape')
            expect(drawer).to_have_count(0)
            expect(trigger).to_be_focused()
            trigger.tap()
            done = drawer.get_by_role('button', name='完成')
            expect(done).to_be_in_viewport()
            done.tap()
            expect(drawer).to_have_count(0)
        footer = page.get_by_role('navigation', name='社区与支持')
        if mobile:
            options = page.get_by_role('group', name='选择答案')
            actions = page.locator('footer.glass-footer:visible')
            expect(options).to_be_visible()
            expect(actions.get_by_role('button', name='答题卡', exact=True)).to_be_visible()
            answer_box, action_box, footer_box = (loc.bounding_box() for loc in (options, actions, footer))
            assert answer_box and action_box and footer_box
            assert answer_box['y'] + answer_box['height'] <= action_box['y'] + 1
            assert action_box['y'] + action_box['height'] <= footer_box['y'] + 1
            expect(actions).to_have_css('position', 'static')
        sponsor = footer.locator('a[href="#sponsor"]')
        sponsor.click()
        expect(page.get_by_text('如果有帮助的话，感谢支持维护🥰')).to_be_visible()
        expect(page.get_by_text('如果遗憾没帮助，我会努力改善🥹')).to_be_visible()
        expect(page.get_by_role('img', name='微信收款码')).to_have_js_property('naturalWidth', 309)
        for fragment in ('#feedback', '#chat'):
            footer.locator(f'a[href="{fragment}"]').click()
            expect(page).to_have_url(origin + '/' + fragment)
        expect(page.locator('header a[href="#chat"]')).to_be_visible()
        account = page.get_by_role('link', name='账号', exact=True)
        account.click()
        expect(page.get_by_text('已验证邮箱')).to_be_visible()
        expect(page.get_by_text('alice@example.test', exact=True)).to_be_visible()
        box = page.locator('section[aria-labelledby="account-heading"]').bounding_box()
        assert box and box['width'] <= 400
        assert abs(box['x'] + box['width']/2 - width/2) < 12
        expect(page.locator('footer[lang=en]')).to_have_text('Hua Xiaowei — ZJU')
        failed_path = '**/api/auth/sign-out'
        page.route(failed_path, lambda route: route.fulfill(status=503, content_type='application/json',
                                                            body='{"code":"SERVICE_UNAVAILABLE"}'))
        sign_out = page.get_by_role('button', name='退出登录')
        with page.expect_response(lambda r: r.url.endswith('/api/auth/sign-out')) as failed:
            sign_out.click()
        assert failed.value.status == 503
        expect(page.get_by_text('暂时无法退出，请重试。')).to_be_visible()
        expect(sign_out).to_be_enabled()
        expect(page).to_have_url(origin + '/account')
        page.unroute(failed_path)
        sign_out.click()
        expect(page).to_have_url(origin + '/login')
    finally:
        context.close()


if __name__ == '__main__':
    with sync_playwright() as playwright:
        engine = os.environ.get('EQB_TEST_ENGINE', 'chromium')
        browser = getattr(playwright, engine).launch()
        try:
            for width, height in [(320, 760), (440, 956), (1440, 900)]:
                check_shell(browser, os.environ['EQB_TEST_ORIGIN'], os.environ['EQB_TEST_COOKIE_NAME'], width, height)
                print(f'{engine} {width}x{height} passed', flush=True)
        finally:
            browser.close()
