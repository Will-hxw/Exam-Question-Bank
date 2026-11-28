import re

from playwright.sync_api import expect


def check_auth_autofill(page):
    cdp = page.context.new_cdp_session(page)
    cdp.send('DOM.enable')
    cdp.send('CSS.enable')
    root = cdp.send('DOM.getDocument')['root']['nodeId']
    for selector in ('#auth-email', '#auth-password'):
        node = cdp.send('DOM.querySelector', {'nodeId': root, 'selector': selector})['nodeId']
        cdp.send('CSS.forcePseudoState', {'nodeId': node, 'forcedPseudoClasses': ['autofill']})
        label = page.locator(f'label[for="{selector[1:]}"]')
        expect(label).to_be_visible()
        assert label.bounding_box()['y'] < page.locator(selector).bounding_box()['y']
        cdp.send('CSS.forcePseudoState', {'nodeId': node, 'forcedPseudoClasses': []})
    cdp.detach()


def check_library_pages(page):
    pagination = page.get_by_role('navigation', name='题库分页')
    position = pagination.get_by_label('当前页与总页数')
    next_button = pagination.get_by_role('button', name='下一页')
    rows = page.locator('main article')
    expect(position).to_have_text('1 / 3')
    expect(page.get_by_text('51 道符合条件的题目')).to_be_visible()
    expect(rows).to_have_count(20)
    first_stem = rows.first.locator(':scope > p').first.inner_text()
    initial_color = next_button.evaluate('(element) => getComputedStyle(element).backgroundColor')
    paused = []
    pattern = '**/api/public/questions?offset=20&limit=20'

    def pause(route):
        paused.append(route)

    page.route(pattern, pause)
    next_button.tap()
    expect(pagination.get_by_role('status').filter(has_text='正在加载')).to_have_text('正在加载第 2 页…')
    expect(next_button).to_be_disabled()
    expect(rows.first.locator(':scope > p').first).to_have_text(first_stem)
    assert paused
    for route in paused:
        route.continue_()
    page.unroute(pattern, pause)
    expect(position).to_have_text('2 / 3')
    page.wait_for_function('window.scrollY === 0')
    expect(next_button).to_have_css('background-color', initial_color)
    expect(next_button).to_be_enabled()
    next_button.tap()
    expect(position).to_have_text('3 / 3')
    expect(rows).to_have_count(11)
    expect(next_button).to_be_disabled()
    page_size = pagination.get_by_role('button', name=re.compile('^每页题量'))
    page_size.tap()
    expect(page_size).to_have_attribute('aria-expanded', 'true')
    expect(pagination.get_by_role('button', name='20 题', exact=True)).to_have_attribute('aria-pressed', 'true')
    pagination.get_by_role('button', name='30 题', exact=True).tap()
    expect(page_size).to_have_attribute('aria-expanded', 'false')
    expect(position).to_have_text('1 / 2')
    expect(rows).to_have_count(30)
    expect(next_button).to_be_enabled()


def check_exam_result_header(page):
    heading = page.get_by_role('heading', name='考试结果', exact=True)
    header = heading.locator('..')
    back = header.get_by_role('button', name=re.compile('返回'))
    replay = header.get_by_role('button', name='原卷重考', exact=True)
    expect(back).to_be_visible()
    expect(replay).to_be_enabled()
    left, right = back.bounding_box(), replay.bounding_box()
    assert left['x'] + left['width'] <= right['x'] and abs(left['y'] - right['y']) <= 4
    return replay


def check_exam_history_header(page):
    title = page.get_by_role('heading', name='考试历史', exact=True)
    back = title.locator('..').get_by_role('button', name=re.compile('返回'))
    expect(title).to_be_visible()
    expect(back).to_be_visible()
    left, right = back.bounding_box(), title.bounding_box()
    assert left['x'] + left['width'] <= right['x'] and right['y'] < left['y'] + left['height']


def check_study_footer(page):
    footer = page.get_by_role('contentinfo')
    links = footer.get_by_role('link')
    expect(links).to_have_count(3)
    for index, name in enumerate(['打开聊天区', '打开意见反馈页面', '打开友情赞助页面']):
        expect(links.nth(index)).to_have_accessible_name(name)
    credit = footer.get_by_text('Hua Xiaowei — ZJU', exact=True)
    expect(credit).to_be_visible()
    boxes = [link.bounding_box() for link in links.all()]
    assert all(abs(box['y'] - boxes[0]['y']) < 2 for box in boxes)
    assert all(left['x'] + left['width'] < right['x'] for left, right in zip(boxes, boxes[1:]))
    assert all(0 <= box['x'] and box['x'] + box['width'] <= page.viewport_size['width'] for box in boxes)
    sig = credit.bounding_box()
    assert sig['y'] >= boxes[-1]['y'] + boxes[-1]['height'] or sig['x'] >= boxes[-1]['x'] + boxes[-1]['width']


def practice_settings(page):
    page.get_by_role('button', name='打开练习设置与导航').click()
    return page.get_by_role('dialog')


def select_mode(page, name):
    drawer = practice_settings(page)
    mode = drawer.get_by_role('button', name=name, exact=True)
    mode.click()
    expect(mode).to_have_attribute('aria-pressed', 'true')
    drawer.get_by_role('button', name='完成').click()


def expect_stat(page, value):
    page.get_by_role('button', name='查看学习概览与社区入口').click()
    drawer = page.get_by_role('dialog')
    tile = drawer.get_by_text('已练习', exact=True).locator('..')
    expect(tile.get_by_text(str(value), exact=True)).to_be_visible()
    drawer.get_by_role('button', name='关闭').click()


def exam_sheet(page):
    page.get_by_role('button', name='答题卡', exact=True).click()
    return page.get_by_role('dialog').get_by_role('group', name='题目导航')


def expect_exam_position(page, index):
    expect(page.get_by_role('article', name='当前考题')).to_contain_text(f'第 {index} / 8 题')


def expect_exam_marks(page, positions):
    sheet = exam_sheet(page)
    buttons = sheet.get_by_role('button', name=re.compile('已标记'))
    if positions:
        expect(buttons).to_have_text(positions)
    else:
        expect(buttons).to_have_count(0)
        expect(sheet.get_by_role('button', name=re.compile('，已答'))).to_have_count(0)
    page.get_by_role('dialog').get_by_role('button', name='关闭').click()


def exam_jump(page, i):
    exam_sheet(page).get_by_role('button', name=re.compile(f'^第 {i} 题，')).click()
