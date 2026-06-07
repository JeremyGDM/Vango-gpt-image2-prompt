# GPT Image Prompt Collection & GitHub Update SOP

> Project: `/Users/jeremy/webDevelop/Vango-gpt-image2-prompt`
>
> Goal: 定期从 X.com 和 `https://promptsref.com/library/gpt-image` 收集 GPT Image / GPT Image 2 相关图片与 prompt，去重、下载图片、写入 `data/gpt-image-2-prompts.json`，重新生成 README，并把最新内容放在 README 最上面，最后提交并推送到 GitHub。

---

## 1. 核心原则

### 1.1 收集范围

优先收集这些内容：

- GPT Image 2 prompts
- GPT Image prompts
- ChatGPT image generation prompts
- OpenAI image generation prompts
- 带可复用 prompt + 图片效果图的帖子
- 设计、电商、人物、Logo、海报、3D、信息图相关高质量 prompt

暂时不收集：

- 只有图片、没有 prompt 的内容
- 低质量水贴
- 明显广告/搬运但没有来源的内容
- NSFW、露骨色情、违法、仇恨内容
- 没有明确授权且不方便 attribution 的图片资源

### 1.2 每条数据必须包含

每条 prompt 至少需要这些字段：

```json
{
  "id": "source-specific-stable-id",
  "title": "Short readable title",
  "category": "Portrait & People",
  "image": "https://raw.githubusercontent.com/JeremyGDM/Vango-gpt-image2-prompt/main/images/prompts/example.jpg",
  "prompt": "Full prompt text...",
  "author": "@author_or_site",
  "authorUrl": "https://x.com/author",
  "sourceUrl": "https://x.com/author/status/123",
  "tags": ["portrait", "product"],
  "localImagePath": "images/prompts/example.jpg",
  "collectedAt": "2026-06-06T00:00:00Z",
  "sourceType": "x"
}
```

### 1.3 排序规则

最新采集的内容必须排在最上面：

1. 新增 prompts 按 `collectedAt` 降序
2. 没有 `collectedAt` 的老数据放后面
3. 同一时间内按来源发布时间或采集顺序排序

---

## 2. 推荐目录结构

在当前仓库新增自动化脚本：

```text
scripts/
  collect-x-prompts.mjs
  collect-promptsref.mjs
  normalize-prompts.mjs
  download-images.mjs
  rebuild-readme.mjs
  run-update.mjs
  utils/
    categories.mjs
    dedupe.mjs
    image.mjs
    prompt-cleaner.mjs

data/
  gpt-image-2-prompts.json
  collection-sources.json
  collection-log.json
  rejected-prompts.json

images/
  prompts/

README.md
SOURCE.md
```

---

## 3. 凭据和登录

### 3.1 X.com

X.com 最稳定方式是使用官方 API 或已有登录态浏览器自动化。

优先级：

1. 官方 X API / Bearer Token
2. Playwright 使用本机浏览器登录态
3. 手动导出搜索结果再导入

不要把 token 写进代码或提交到 GitHub。

`.env` 示例：

```bash
X_BEARER_TOKEN="[REDACTED]"
GITHUB_REPO="JeremyGDM/Vango-gpt-image2-prompt"
```

`.gitignore` 必须包含：

```gitignore
.env
.playwright-auth/
```

### 3.2 promptsref.com

先走正常公开页面抓取：

- URL: `https://promptsref.com/library/gpt-image`
- 抓取列表页 prompt card
- 进入详情页抓完整 prompt、图片、标题、分类
- 如果站点有 robots / rate limit，降低频率，不要高并发

---

## 4. 定期执行流程

### Step 1: 进入仓库

```bash
cd /Users/jeremy/webDevelop/Vango-gpt-image2-prompt
```

### Step 2: 确认工作区干净

```bash
git status --short
```

预期：没有输出。

如果有未提交文件，先暂停，确认是否需要保留。

### Step 3: 拉最新 main

```bash
git pull --rebase origin main
```

### Step 4: 从 promptsref 抓取

```bash
node scripts/collect-promptsref.mjs \
  --url "https://promptsref.com/library/gpt-image" \
  --limit 100 \
  --out data/incoming-promptsref.json
```

输出：

```text
Collected: N
Skipped: N
Failed: N
Output: data/incoming-promptsref.json
```

### Step 5: 从 X.com 抓取

建议搜索关键词：

```text
"GPT Image 2" prompt
"GPT-Image-2" prompt
"ChatGPT image" prompt
"OpenAI image" prompt
"gpt image" "prompt"
"gpt image 2" "source tweet"
```

执行：

```bash
node scripts/collect-x-prompts.mjs \
  --queries data/x-search-queries.txt \
  --limit-per-query 30 \
  --out data/incoming-x.json
```

### Step 6: 清洗、分类、去重

```bash
node scripts/normalize-prompts.mjs \
  --input data/incoming-promptsref.json,data/incoming-x.json \
  --existing data/gpt-image-2-prompts.json \
  --out data/gpt-image-2-prompts.json \
  --rejected data/rejected-prompts.json
```

去重依据：

- `sourceUrl` 完全相同
- prompt 文本 hash 相同
- 图片 URL 相同
- 本地图片文件名 / 图片内容 hash 相同
- 标题 + 作者 + prompt 前 120 字相似

硬性要求：

- 已经收录过的图片和 prompt 不允许重复加入。
- 如果图片重复但 prompt 略有改写，默认视为重复，除非来源明确是不同作品/不同版本。
- 如果 prompt 重复但图片不同，先放入 `data/rejected-prompts.json` 或人工复核，不要直接写入主数据。

去重逻辑必须持续翻页，直到凑满本次目标新增数量或来源没有更多结果。例如每天目标是 100 条时：

1. 先抓最新页。
2. 最新页去重后不够 100 条，就继续抓更旧页面。
3. 继续过滤已收录图片 / prompt / sourceUrl。
4. 直到新增凑满 100 条，或来源站没有更多可用公开记录。

### Step 7: 下载/镜像图片

```bash
node scripts/download-images.mjs \
  --data data/gpt-image-2-prompts.json \
  --image-dir images/prompts \
  --report data/download-report.json
```

要求：

- 新图片保存到 `images/prompts/`
- 文件名优先用 source id，例如 `x-2051202480793686229.jpg`
- 更新每条数据的 `localImagePath`
- 更新 `image` 为 GitHub raw URL

### Step 8: 重新生成 README，最新内容置顶

```bash
node scripts/rebuild-readme.mjs \
  --data data/gpt-image-2-prompts.json \
  --out README.md \
  --latest-first true
```

README 结构建议：

```md
# Vango GPT Image 2 Prompts

1292+ mirrored prompts for GPT Image 2...

## Latest Prompts

最新采集的 50-100 条放这里。

## Categories Overview

分类统计。

## All Prompts

按分类展示，但分类内也按最新优先。
```

### Step 9: 校验数据

```bash
node -e "const d=require('./data/gpt-image-2-prompts.json'); console.log(d.count, d.prompts.length); if(d.count!==d.prompts.length) process.exit(1)"
```

再检查 README 是否包含最新数据：

```bash
grep -n "Latest Prompts" README.md | head
```

### Step 10: 查看改动

```bash
git status --short
git diff --stat
```

### Step 11: 提交

如果新增内容数量大于 0：

```bash
git add README.md SOURCE.md data images scripts package.json package-lock.json .gitignore

git commit -m "data: update GPT image prompt collection"
```

如果没有新增内容，不提交。

### Step 12: 推送 GitHub

```bash
git push origin main
```

---

## 5. 自动化脚本总入口

最终应该只需要跑：

```bash
node scripts/run-update.mjs --push
```

等价于：

1. 检查 git 状态
2. 拉取最新 main
3. 抓 promptsref
4. 抓 X.com
5. 清洗去重
6. 下载图片
7. 生成 README
8. 校验 JSON / README
9. commit
10. push

---

## 6. 定时任务建议

### 6.1 本机 cron / launchd

建议频率：每天 1 次或每周 2-3 次。

命令：

```bash
cd /Users/jeremy/webDevelop/Vango-gpt-image2-prompt && node scripts/run-update.mjs --limit 100 --push
```

### 6.2 Hermes cronjob

如果用 Hermes 定时：

- Schedule: `0 9 * * *`
- Workdir: `/Users/jeremy/webDevelop/Vango-gpt-image2-prompt`
- Prompt:

```text
Run the GPT image prompt update SOP. Execute node scripts/run-update.mjs --limit 100 --push. If it fails, diagnose the failure, do not fabricate success, and report the exact blocker and logs.
```

---

## 7. 分类规则

固定分类保持和现有 README 一致：

- `Portrait & People`
- `Product & E-commerce`
- `Brand & Logos`
- `Character Design`
- `Charts & Infographics`
- `Illustration & Art`
- `Posters & Typography`
- `3D Renders`
- `Before / After & Comparisons`

自动分类关键词：

- portrait, selfie, headshot, person, model, fashion → `Portrait & People`
- product, ecommerce, packaging, bottle, ad → `Product & E-commerce`
- logo, brand, identity, icon → `Brand & Logos`
- character, mascot, anime, game character → `Character Design`
- infographic, chart, diagram, map → `Charts & Infographics`
- illustration, painting, art style → `Illustration & Art`
- poster, typography, cover, flyer → `Posters & Typography`
- 3d, render, isometric, clay, blender → `3D Renders`
- before after, comparison, grid, transform → `Before / After & Comparisons`

---

## 8. 质量检查清单

每次更新前后检查：

- [ ] `git status --short` 更新前干净
- [ ] 新数据有 `title`
- [ ] 新数据有完整 `prompt`
- [ ] 新数据有 `sourceUrl`
- [ ] 新数据有 `author` 或网站 attribution
- [ ] 新图片已下载到 `images/prompts/`
- [ ] `data.gpt-image-2-prompts.json.count === prompts.length`
- [ ] README 最新内容在最上面
- [ ] README 图片路径可用
- [ ] 没有提交 `.env` / token / cookie
- [ ] commit message 清楚
- [ ] `git push origin main` 成功

---

## 9. 合规和避坑

- X.com 不要高频爬取，不要绕过登录/风控。
- 保留作者和来源链接。
- 如果来源网站明确禁止抓取，停止自动抓取。
- 不要采集敏感、违法、NSFW 内容。
- 图片如果只适合引用展示，要保留来源 attribution。
- 不要提交 cookies、token、API key。
- 如果 prompt 里包含真人名/名人 likeness，按平台策略决定是否保留或标记。

---

## 10. 推荐后续实现顺序

1. 新增 `package.json`，安装 `playwright`、`cheerio`、`slugify`。
2. 写 `scripts/collect-promptsref.mjs`。
3. 写 `scripts/normalize-prompts.mjs`。
4. 写 `scripts/download-images.mjs`。
5. 写 `scripts/rebuild-readme.mjs`，确保最新内容置顶。
6. 写 `scripts/collect-x-prompts.mjs`。
7. 写 `scripts/run-update.mjs` 总入口。
8. 本地跑一次，确认新增数据和 README 顺序。
9. commit + push。
10. 配 Hermes cronjob 或 launchd 定时执行。
