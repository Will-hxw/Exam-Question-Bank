# 重庆大学入党积极分子练习

[在线体验](https://w99.site/cquccp/index.html)

![Static Site](https://img.shields.io/badge/static-site-111827?style=flat-square)
![Vanilla JS](https://img.shields.io/badge/vanilla-js-f7df1e?style=flat-square&logo=javascript&logoColor=111827)
![Offline Ready](https://img.shields.io/badge/offline-ready-059669?style=flat-square)

纯静态刷题网站，无需后端，打开即用。

## 功能

| 模块 | 说明 |
| --- | --- |
| 刷题练习 | 按专题、随机、顺序三种模式 |
| 模拟考试 | 随机抽题，计时作答，记录历史成绩与错题 |
| 错题复习 | 自动间隔重复，连续答对自动移出 |
| 收藏夹 | 收藏重点题目，单独练习 |
| 总题库 | 全题库检索，支持关键词、题型、状态筛选 |
| AI 解析 | DeepSeek 实时解析题目考点、答案与逐项说明 |
| 离线缓存 | Service Worker 缓存首页与题库，二次秒开 |

数据全部存储在浏览器 `localStorage`，不上传用户数据。

## 项目结构

```
├── build.py                 # 构建脚本
├── src/
│   ├── app.js               # 主应用逻辑
│   ├── storage.js           # 本地状态管理
│   ├── ai.js                # AI 解析（DeepSeek 直连）
│   └── sw.js                # Service Worker 源码
├── data/
│   ├── questions.json       # 源题库
│   └── json/                # 分专题题库（13 个专题）
├── assets/
│   ├── icon.jpg             # 原始图标
│   └── wechat.png           # 赞助收款码
└── cloudflare-worker/       # （已废弃，保留参考）
```

## 本地构建

```powershell
# 构建部署文件到 tmp/ 和 final/
python build.py

# 本地预览
cd final && python -m http.server 3000 --bind 127.0.0.1
```

可选依赖：Pillow（用于生成压缩图标，缺失时回退原始图标）。

## 部署

上传 `final/` 或 `tmp/` 目录下的文件到静态服务器：

```
index.html
sw.js
questions-compact.<hash>.json
questions-compact.json
icon.<hash>.jpg
wechat.png
```

题库更新后哈希文件名自动变化，建议保留旧哈希文件一段时间。

## 更新题库

1. 修改 `data/questions.json`
2. 运行 `python build.py`
3. 上传新生成的部署文件

## 隐私

本项目无后端，不收集任何用户数据。答题记录、错题、收藏、考试历史均仅存储在浏览器本地。

## License

代码采用 [MIT License](LICENSE)。题库内容仅用于学习参考，原始权利归属不变。
