<div align="center">

# 重庆大学入党积极分子练习

面向手机端的静态刷题系统，覆盖练习、模拟考试、错题复习、收藏与题库检索。

[在线体验](https://w99.site/cquccp/index.html) · [本地构建](#本地构建) · [部署说明](#部署) · [题库更新](#更新题库)

![Static Site](https://img.shields.io/badge/static-site-111827?style=flat-square)
![Vanilla JS](https://img.shields.io/badge/vanilla-js-f7df1e?style=flat-square&logo=javascript&logoColor=111827)
![Mobile First](https://img.shields.io/badge/mobile-first-2563eb?style=flat-square)
![Offline Ready](https://img.shields.io/badge/offline-ready-059669?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-7c3aed?style=flat-square)

</div>

## Overview

这是一个为入党积极分子学习场景设计的轻量级刷题网站。项目不依赖后端、不依赖构建框架，核心文件可直接部署到任意静态托管平台。

当前线上版本：

```text
https://w99.site/cquccp/index.html
```

设计目标很明确：

- 手机端优先，打开即用。
- 纯静态部署，维护成本低。
- 题库可更新，缓存不挡新版。
- 个人进度保存在本地，不上传用户数据。
- 弱网络下仍尽量保持可用体验。

## Highlights

| 能力 | 说明 |
| --- | --- |
| 刷题练习 | 支持随机、顺序、错题、收藏四种练习模式 |
| 模拟考试 | 随机抽取 50 题，记录历史成绩和错题详情 |
| 错题复习 | 根据答题结果自动维护错题状态，支持移出错题集 |
| 收藏夹 | 收藏重点题目，单独集中练习 |
| 总题库检索 | 支持关键词搜索、题型筛选、完成状态筛选 |
| 本地进度 | 使用 `localStorage` 保存答题记录、错题、收藏和考试历史 |
| 离线与缓存 | 使用 Service Worker 缓存首页、题库和图标 |

## Performance Design

项目针对移动端和微信/QQ 内置浏览器做了专门优化。

- **首屏内联题目**：`index.html` 内联少量题目，页面不必等待完整题库下载即可进入练习。
- **完整题库延后加载**：完整 JSON 题库在首屏渲染后空闲加载，避免抢占首次渲染资源。
- **题库内容哈希**：部署文件使用 `questions-compact.<hash>.json`，题库更新后 URL 自动变化。
- **缓存优先首页**：Service Worker 对首页使用 cache-first，并在后台刷新新版 HTML，提升二次打开速度。
- **小尺寸图标**：构建时从原始图标生成 64x64 优化 JPEG，减少首屏图片传输。
- **无第三方运行时**：页面运行不加载外部 JS/CSS/CDN，降低网络不确定性。

当前构建产物体积参考：

| 文件 | 作用 |
| --- | --- |
| `index.html` | 单页入口，内联样式、脚本和首屏题目 |
| `sw.js` | Service Worker 缓存策略 |
| `questions-compact.d5a741f70c.json` | 当前题库哈希文件 |
| `questions-compact.json` | 兼容 fallback |
| `icon.98efd515c8.jpg` | 64x64 部署图标 |
| `wechat.png` | 友情赞助收款码 |

## Architecture

```text
src/                        # JS 源码
    ├── app.js
    ├── storage.js
    ├── ai.js
    └── sw.js
data/                       # 题库数据
    ├── questions.json
    └── json/*.json
assets/                     # 静态资源
    ├── icon.jpg
    └── wechat.png
    │
    ▼
build.py
    ├── index.html          # 部署入口（内联所有 JS/CSS）
    ├── sw.js               # Service Worker
    ├── questions-compact.json
    ├── questions-compact.<hash>.json
    └── icon.<hash>.jpg
```

运行时结构：

```text
index.html
    ├── storage.js    # 本地状态、错题、收藏、历史记录
    ├── app.js        # 页面渲染、练习模式、模拟考试
    └── sw.js         # 缓存首页、题库和图标
```

## Project Structure

```text
.
├── build.py                            # 构建脚本
├── src/
│   ├── app.js                          # 主应用逻辑
│   ├── storage.js                      # 本地刷题状态与历史记录
│   ├── ai.js                           # AI 解析模块
│   └── sw.js                           # Service Worker 源码
├── data/
│   ├── questions.json                  # 源题库
│   └── json/                           # 分专题题库
│       ├── 0-综合精选易错题库.json
│       ├── ...
│       └── 11-作者精选题库.json
├── assets/
│   ├── icon.jpg                        # 原始图标
│   └── wechat.png                      # 友情赞助收款码
├── cloudflare-worker/                  # API 代理 Worker
├── README.md
└── LICENSE
```

## Local Development

环境要求：

- Python 3.12 或兼容版本
- 可选：Pillow，用于生成 64x64 小图标。缺失时构建脚本会回退使用原始图标。

构建部署文件：

```powershell
python build.py
```

本地启动静态服务（构建产物在 final/ 目录下）：

```powershell
cd final && python -m http.server 3000 --bind 127.0.0.1
```

然后访问：

```text
http://127.0.0.1:3000/index.html
```

如果需要直接用 `file://` 打开本地页面，可额外生成 `questions.js` fallback：

```powershell
python build.py --local
```

`questions.js` 是本地调试生成物，已加入 `.gitignore`，不提交到仓库。

## Deployment

当前站点部署在 900.cool：

```text
https://w99.site/cquccp/index.html
```

每次部署上传构建输出中的这些文件：

```text
index.html
sw.js
questions-compact.<hash>.json
questions-compact.json
icon.<hash>.jpg
wechat.png
```

当前版本对应：

```text
index.html
sw.js
questions-compact.d5a741f70c.json
questions-compact.json
icon.98efd515c8.jpg
wechat.png
```

不需要上传：

```text
questions.js
docs/
.playwright-mcp/
__pycache__/
```

## Update Question Bank

更新题库只需要维护源文件 `questions.json`。

1. 修改 `questions.json`。
2. 运行构建：

```powershell
python build.py
```

3. 上传新的部署文件：

```text
index.html
sw.js
questions-compact.<newhash>.json
questions-compact.json
icon.<hash>.jpg
wechat.png
```

题库内容变化后，哈希文件名会变化。旧哈希题库建议保留一段时间，避免已经打开旧页面的用户请求不到旧文件。

## Privacy

本项目没有后端服务，不收集、不上传用户刷题数据。

以下数据仅保存在用户浏览器本地：

- 答题记录
- 错题状态
- 收藏题目
- 模拟考试历史
- 当前练习模式和顺序练习进度

用户清理浏览器数据、切换浏览器或切换微信/QQ/系统浏览器入口后，本地记录可能不同。

## Roadmap

- 首题静态 HTML 直出，进一步减少首次渲染等待
- 只读状态读取，避免统计逻辑膨胀 `localStorage`
- 题库来源与版本信息在页面内可视化
- 更细粒度的错题复习间隔与复习提醒

## Disclaimer

本项目仅供学习参考。题目、资料和答案应以重庆大学相关要求及权威公开资料为准。

如发现题目错误、答案争议或内容需要更新，请联系站点维护者。

## License

项目代码采用 [MIT License](LICENSE)。

题库内容、公开学习资料摘录及其原始来源材料不因本仓库开源而改变其原有权利归属，仅用于学习参考。
