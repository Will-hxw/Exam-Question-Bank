# 重庆大学入党积极分子练习

[exam-question-bank-1pm.pages.dev](https://exam-question-bank-1pm.pages.dev)

## 功能

| 模块 | 说明 |
| --- | --- |
| 刷题练习 | 按专题、随机、顺序三种模式 |
| 模拟考试 | 随机抽题，计时作答，记录历史成绩与错题 |
| 错题复习 | 自动间隔重复，连续答对自动移出 |
| 收藏夹 | 收藏重点题目，单独练习 |
| 总题库 | 全题库检索，支持关键词、题型、状态筛选 |
| AI 解析 | DeepSeek 直连，实时解析考点、答案与逐项说明 |
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
└── cloudflare-worker/       # 已废弃，保留参考
```

## 本地构建与预览

```powershell
python build.py

# 本地预览
cd final && python -m http.server 3000 --bind 127.0.0.1
```

## 部署

见 [`cloudflare-worker/deploy.md`](cloudflare-worker/deploy.md)。

## 更新题库

1. 修改 `data/questions.json`
2. `python build.py` 重新构建
3. 重新部署

## 隐私

无后端，不收集任何用户数据。答题记录、错题、收藏、考试历史均仅存储在浏览器本地。清理浏览器数据会丢失。

## License

代码 [MIT License](LICENSE)。题库内容仅用于学习参考。
