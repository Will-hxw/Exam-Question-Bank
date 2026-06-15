# Cloudflare Pages 部署指南

## 首次部署

```powershell
# 1. 登录 Cloudflare（仅首次）
npx wrangler login

# 2. 创建 Pages 项目（仅首次）
npx wrangler pages project create exam-question-bank --production-branch main

# 3. 构建
python build.py

# 4. 部署
npx wrangler pages deploy final/ --project-name exam-question-bank --commit-dirty=true
```

成功后输出：
- 生产地址：`https://exam-question-bank-1pm.pages.dev`
- 预览地址：`https://<hash>.exam-question-bank-1pm.pages.dev`

## 日常更新

修改代码或题库后：

```powershell
python build.py
npx wrangler pages deploy final/ --project-name exam-question-bank --commit-dirty=true
```

已存在的文件自动跳过，只上传变化的内容。

## 自定义域名

在 Cloudflare Dashboard → Pages → exam-question-bank → 自定义域 添加。

绑定自定义域名可显著改善国内访问。
