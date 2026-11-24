# 重庆大学入党积极分子练习

专题刷题、可选 1–100 题的不限时模拟考试、中文搜索、错题和收藏。使用邮箱注册并验证后登录，学习数据按账号保存。

正式站为 [cqu.xiaoweihua.cn](https://cqu.xiaoweihua.cn/)。前后端使用 Next.js，数据和认证使用 Neon，GitHub 的 `main` 分支自动部署至 EdgeOne Makers。

## 本地开发

使用 Node.js 24 和 PostgreSQL 16+。邮箱登录需要隔离的 Neon Auth 开发环境。

```sh
npm ci
npm run db:migrate
npm run content:sync             # 在事务中验证并回滚
npm run content:sync -- --apply  # 将内容同步到配置的开发数据库
npm run dev
```

运行命令前，按 [环境示例](.env.example) 配置开发环境。迁移与题库同步使用 `CONTENT_DATABASE_URL` 或运维直连地址，应用请求使用运行时 `DATABASE_URL`。本地和预览环境使用隔离的数据库及认证配置。

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

集成测试需要提供具备建库权限的开发集群 `TEST_DATABASE_URL`，测试会创建并清理独立数据库。浏览器端到端测试使用独立的生产构建和环回 PostgreSQL，见 [复跑命令](docs/PERFORMANCE.md#复跑端到端测试)。

## 文档

| 事项 | 入口 |
| --- | --- |
| 开发配置、部署、数据库迁移和回滚 | [部署手册](docs/DEPLOY.md) |
| 功能回归、已验证事项和真实环境的验收缺口 | [验收证据](docs/ACCEPTANCE.md) · [执行状态](docs/EXECUTION_STATUS.md) |
| 题库编审、考纲来源和公开范围 | [编审和发布](docs/CONTENT_REVIEW.md) · [考纲依据](docs/SYLLABUS_MAP.md) · [来源台账](docs/SOURCE_CATALOG.csv) |
| 历史环境和界面对照 | [Neon 联调实录](docs/NEON_SETUP.md) · [平台早期核查](docs/PLATFORM_CHECK.md) · [界面对照](docs/UI_BASELINE.md) |

## 文件维护

| 路径 | 用途 |
| --- | --- |
| `src/`、`db/migrations/`、`content/` | 站点源码、数据库迁移和题库源文件 |
| `research/review/`、`docs/baseline/` | 编审证据和界面基准；本地忽略的 `research/raw/`、`research/extracted/` 存放原件及核对资料 |
| `.env.local`、`.neon`、`.edgeone/project.json` | 本机环境变量、Neon 项目绑定和 Makers 项目绑定，由 Git 忽略 |
| `node_modules/`、`.next/`、`public/bank/` | 依赖、构建和题库分片，由 `npm ci`、`npm run build` 和 `npm run content:build` 生成；本机预览运行期间保留 |
| `tmp/` | 测试和审阅输出。需要全量审阅 JSON 时，运行 `npm run content:review` 生成 `tmp/题库全量审阅.json` |

代码采用 [MIT License](LICENSE)。题库内容仅供学习参考。
