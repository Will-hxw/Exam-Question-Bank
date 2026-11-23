# 重庆大学入党积极分子练习

专题刷题、50 题不限时模拟练习、中文搜索、错题和收藏。使用邮箱注册并验证后登录，学习数据按账号保存。

正式域名为 `https://cqu.xiaoweihua.cn`。建设与验收进度见 [执行状态](docs/EXECUTION_STATUS.md)。

## 本地开发

使用 Node.js 24 和 PostgreSQL 16+。邮箱登录需要隔离的 Neon Auth 开发环境。

```sh
npm ci
npm run db:migrate
npm run content:sync           # 在事务中验证并回滚
npm run content:sync -- --apply # 将内容同步到本机数据库
npm run dev
```

按 [环境示例](.env.example) 向本地进程配置变量。迁移与题库同步使用操作方的 `CONTENT_DATABASE_URL` 或运维直连地址，应用请求使用运行时 `DATABASE_URL`。邮件授权码在托管平台安全设置中配置。

## 题库

- 在 `content/` 的 JSON 中维护题目、来源、专题和知识点。沿用题目和选项的 UUID，修订时重审，停用时保留记录。
- `npm run content:validate` 执行结构和引用检查。`npm run content:quality` 输出覆盖、重复候选、情绪线索题、全选和答案分布。
- `npm run content:review` 导出审阅 JSON，每道题显示题号、题型、题干、字母选项、正确答案和解析。来源与审核记录保存在编审数据中。
- `npm run content:build` 从事实和考法均通过的题目生成 CDN 分片。发布时 PostgreSQL 同步同一份内容，用于搜索、个人筛选、组卷与判分。
- 来源以共产党员网的正式文本、重庆大学的公开通知和现行校规为主。 [考纲依据](docs/SYLLABUS_MAP.md) · [来源台账](docs/SOURCE_CATALOG.csv) · [编审和发布](docs/CONTENT_REVIEW.md)

## 验证与部署

```sh
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
```

集成测试需要提供具备建库权限的开发集群 `TEST_DATABASE_URL`，测试会创建并清理独立数据库。EdgeOne Makers 从 GitHub 的 `main` 构建正式站。环境配置、发布保护和回滚见 [部署手册](docs/DEPLOY.md)。已通过和待完成的项目见 [验收证据](docs/ACCEPTANCE.md)。

代码采用 [MIT License](LICENSE)。题库内容仅供学习参考。
