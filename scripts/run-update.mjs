import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, 'data/gpt-image-2-prompts.json');
const README_PATH = path.join(ROOT, 'README.md');
const IMAGE_DIR = path.join(ROOT, 'images/prompts');
const REPORT_PATH = path.join(ROOT, 'data/download-report.json');
const SOURCE_URL = 'https://promptsref.com/library/gpt-image';
const RAW_BASE = 'https://raw.githubusercontent.com/JeremyGDM/Vango-gpt-image2-prompt/main';

function argValue(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  if (hit) return hit.slice(name.length + 1);
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

const LIMIT = Number(argValue('--limit', '20')) || 20;
const SHOULD_PUSH = process.argv.includes('--push');

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; VangoPromptCollector/1.0)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} ${res.statusText}: ${url}`);
  return await res.text();
}

function extractPushPayload(scriptText) {
  const match = scriptText.match(/self\.__next_f\.push\((.*)\)$/s);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function extractFlightTexts(html) {
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const texts = [];
  for (const script of scripts) {
    if (!script.includes('self.__next_f.push')) continue;
    const payload = extractPushPayload(script.trim());
    if (payload && typeof payload[1] === 'string') texts.push(payload[1]);
  }
  return texts;
}

function extractStringRefs(flightTexts) {
  const refs = new Map();
  for (const text of flightTexts) {
    const match = text.match(/^([0-9a-f]+):T[0-9a-f]+,([\s\S]*)$/);
    if (match) refs.set(`$${match[1]}`, match[2]);
  }
  return refs;
}

function extractWorks(flightTexts) {
  const text = flightTexts.find((t) => t.includes('"works"'));
  if (!text) throw new Error('Could not find works payload in promptsref page');
  const key = text.indexOf('"works"');
  const start = text.indexOf('[', key);
  if (start === -1) throw new Error('Could not find works array start');

  let level = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '[') level += 1;
    else if (ch === ']') {
      level -= 1;
      if (level === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error('Could not parse works array');
}

function resolvePrompt(prompt, refs) {
  if (!prompt) return '';
  if (/^\$[0-9a-f]+$/i.test(prompt) && refs.has(prompt)) return refs.get(prompt).trim();
  return String(prompt).trim();
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'prompt';
}

function titleFromPrompt(prompt, id) {
  const first = prompt.split(/\r?\n/).map((s) => s.trim()).find(Boolean) || `Promptsref GPT Image Prompt ${id}`;
  return first
    .replace(/^[-–—\s]+/, '')
    .replace(/[*_`#]/g, '')
    .slice(0, 72)
    .replace(/[,.，。:：;；\s]+$/g, '') || `Promptsref GPT Image Prompt ${id}`;
}

function classify(prompt) {
  const t = prompt.toLowerCase();
  if (/before|after|comparison|grid|transform|redraw|attached image|reference image/.test(t)) return 'Before / After & Comparisons';
  if (/product|packaging|e-?commerce|bottle|cosmetic|advertisement|commercial/.test(t)) return 'Product & E-commerce';
  if (/logo|brand|identity|icon|mascot/.test(t)) return 'Brand & Logos';
  if (/character|anime|cosplay|game|creature|pokemon|robot|2b/.test(t)) return 'Character Design';
  if (/infographic|chart|diagram|map|workflow|timeline/.test(t)) return 'Charts & Infographics';
  if (/poster|typography|cover|flyer|title|layout/.test(t)) return 'Posters & Typography';
  if (/3d|render|isometric|blender|cgi|clay/.test(t)) return '3D Renders';
  if (/portrait|selfie|person|woman|man|face|fashion|model|headshot|skin/.test(t)) return 'Portrait & People';
  return 'Illustration & Art';
}

function tagsFor(prompt, category) {
  const tags = new Set();
  const t = prompt.toLowerCase();
  const categoryTag = {
    'Portrait & People': 'portrait',
    'Product & E-commerce': 'product',
    'Brand & Logos': 'branding',
    'Character Design': 'character',
    'Charts & Infographics': 'infographic',
    'Illustration & Art': 'illustration',
    'Posters & Typography': 'poster',
    '3D Renders': '3d-render',
    'Before / After & Comparisons': 'comparison',
  }[category];
  if (categoryTag) tags.add(categoryTag);
  if (t.includes('gpt')) tags.add('gpt-image');
  if (t.includes('prompt')) tags.add('prompt');
  if (t.includes('cinematic')) tags.add('cinematic');
  if (t.includes('logo')) tags.add('logo');
  return [...tags];
}

function normalizeWork(work, refs) {
  const prompt = resolvePrompt(work.prompt, refs);
  if (!prompt || prompt.length < 20) return null;
  if (!work.canViewPrompt || work.promptLocked) return null;
  const id = `promptsref-${work.id}`;
  const imageName = `${id}${extensionFromUrl(work.output_image_url)}`;
  const localImagePath = `images/prompts/${imageName}`;
  const category = classify(prompt);
  return {
    id,
    title: titleFromPrompt(prompt, work.id),
    category,
    image: `${RAW_BASE}/${localImagePath}`,
    prompt,
    author: work.user_name || work.user_handle || 'promptsref',
    authorUrl: work.user_handle ? `https://promptsref.com/user/${work.user_handle}` : 'https://promptsref.com',
    sourceUrl: `https://promptsref.com${work.tool_url || '/tool/AI-Image-Generator'}?share_id=${work.share_id}&show=true`,
    tags: tagsFor(prompt, category),
    localImagePath,
    collectedAt: new Date().toISOString(),
    sourceType: 'promptsref',
    sourceCreatedAt: work.created_at,
    sourceImageUrl: work.output_image_url,
  };
}

function extensionFromUrl(url) {
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return ext;
  } catch {}
  return '.jpg';
}

function promptHash(prompt) {
  return createHash('sha256').update(prompt.replace(/\s+/g, ' ').trim().toLowerCase()).digest('hex');
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function collectPromptsRef() {
  const html = await fetchText(SOURCE_URL);
  const flightTexts = extractFlightTexts(html);
  const refs = extractStringRefs(flightTexts);
  const works = extractWorks(flightTexts);
  const normalized = works.map((work) => normalizeWork(work, refs)).filter(Boolean);
  normalized.sort((a, b) => String(b.sourceCreatedAt || '').localeCompare(String(a.sourceCreatedAt || '')));
  return normalized;
}

async function downloadImage(entry) {
  await mkdir(path.join(ROOT, path.dirname(entry.localImagePath)), { recursive: true });
  const target = path.join(ROOT, entry.localImagePath);
  if (existsSync(target)) return { status: 'skipped', path: entry.localImagePath };
  const url = entry.sourceImageUrl || entry.image;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VangoPromptCollector/1.0)' },
  });
  if (!res.ok) throw new Error(`Image download failed ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(target, buf);
  return { status: 'downloaded', path: entry.localImagePath, bytes: buf.length };
}

function readmeEntry(entry, index) {
  const source = entry.sourceUrl ? ` · [Source](${entry.sourceUrl})` : '';
  const tags = entry.tags?.length ? ` · Tags: ${entry.tags.map((t) => `\`${t}\``).join(', ')}` : '';
  return `#### ${index}. ${entry.title}\n\n<img src="${entry.localImagePath}" alt="${entry.title.replaceAll('"', '&quot;')}" width="560">\n\n<details><summary><strong>📝 Prompt</strong> (click to expand)</summary>\n\n\`\`\`text\n${entry.prompt}\n\`\`\`\n\n</details>\n\n👤 ${entry.authorUrl ? `[${entry.author}](${entry.authorUrl})` : entry.author}${source}${tags}\n\n---\n`;
}

function buildReadme(data) {
  const prompts = data.prompts;
  const categories = new Map();
  for (const p of prompts) categories.set(p.category, (categories.get(p.category) || 0) + 1);
  const latest = prompts.filter((p) => p.collectedAt).slice(0, 40);
  const old = prompts.filter((p) => !p.collectedAt);
  const total = prompts.length;
  const catRows = [...categories.entries()].map(([cat, count]) => `| ${cat} | ${count} |`).join('\n');
  const latestBlock = latest.length
    ? latest.map((p, i) => readmeEntry(p, i + 1)).join('\n')
    : '> No newly collected prompts yet.\n';
  const oldBlock = old.map((p, i) => readmeEntry(p, i + 1)).join('\n');

  return `<h1 align="center">🎨 Vango GPT Image 2 Prompts</h1>\n\n<p align="center">\n  <strong>${total} mirrored prompts for GPT Image 2</strong>,<br>\n  curated from X/Twitter and prompt libraries, organized by category, with preview images mirrored in this repository.\n</p>\n\n<p align="center">\n  <a href="https://github.com/JeremyGDM/Vango-gpt-image2-prompt"><img src="https://img.shields.io/github/stars/JeremyGDM/Vango-gpt-image2-prompt?style=flat-square" alt="Stars"></a>\n  <img src="https://img.shields.io/badge/prompts-${total}-blueviolet?style=flat-square" alt="Prompts">\n  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License">\n</p>\n\n<p align="center">\n  <a href="https://happyhorses.site/"><strong>🌐 Browse and generate at Happy Horses</strong></a>\n</p>\n\n---\n\n## 🤔 What is this?\n\nA mirrored library of GPT Image 2 prompts collected from X/Twitter and prompt libraries, with original authors credited and preview renders stored directly in this repository. Use it to browse proven prompt patterns without depending on third-party image hotlinks.\n\n## 🆕 Latest Prompts\n\n> Newest collected prompts appear here first.\n\n${latestBlock}\n\n## 🗂️ Categories Overview\n\n| Category | Prompts |\n|---|---:|\n${catRows}\n| **Total** | **${total}** |\n\n---\n\n## 📋 Archived Prompts\n\n> Original mirrored prompts without collection timestamps.\n\n${oldBlock}\n\n## 🤝 Contributing\n\nSend useful GPT Image 2 prompt sources with prompt text, preview image, author, and source URL.\n\n## ⚖️ License & Attribution\n\nThis repository is MIT licensed. Prompt entries retain original author and source attribution where available.\n`;
}

async function main() {
  if (SHOULD_PUSH) {
    const status = execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim();
    if (status && !status.split('\n').every((line) => line.startsWith('?? package.json') || line.startsWith('?? .gitignore') || line.startsWith('?? scripts/'))) {
      console.error(status);
      throw new Error('Working tree has unexpected changes before update');
    }
  }

  const existing = await readJson(DATA_PATH);
  const existingPrompts = existing.prompts || [];
  const existingSourceUrls = new Set(existingPrompts.map((p) => p.sourceUrl).filter(Boolean));
  const existingIds = new Set(existingPrompts.map((p) => p.id));
  const existingHashes = new Set(existingPrompts.map((p) => promptHash(p.prompt || '')));

  const candidates = await collectPromptsRef();
  const additions = [];
  for (const candidate of candidates) {
    if (additions.length >= LIMIT) break;
    if (existingIds.has(candidate.id)) continue;
    if (existingSourceUrls.has(candidate.sourceUrl)) continue;
    if (existingHashes.has(promptHash(candidate.prompt))) continue;
    additions.push(candidate);
  }

  const imageResults = [];
  for (const entry of additions) imageResults.push({ id: entry.id, ...(await downloadImage(entry)) });

  const combined = [...additions, ...existingPrompts];
  const updated = {
    ...existing,
    source: existing.source || 'https://github.com/JeremyGDM/Vango-gpt-image2-prompt',
    generatedAt: new Date().toISOString(),
    count: combined.length,
    prompts: combined,
  };
  await writeJson(DATA_PATH, updated);
  await writeFile(README_PATH, buildReadme(updated));

  const previousReport = existsSync(REPORT_PATH) ? await readJson(REPORT_PATH) : {};
  await writeJson(REPORT_PATH, {
    ...previousReport,
    generatedAt: new Date().toISOString(),
    total: combined.length,
    downloadedThisRun: imageResults.filter((r) => r.status === 'downloaded').length,
    skippedThisRun: imageResults.filter((r) => r.status === 'skipped').length,
    failed: 0,
    failures: [],
  });

  console.log(`Candidates: ${candidates.length}`);
  console.log(`Added: ${additions.length}`);
  console.log(`Images downloaded: ${imageResults.filter((r) => r.status === 'downloaded').length}`);
  console.log(`Total prompts: ${combined.length}`);

  if (SHOULD_PUSH && additions.length > 0) {
    execFileSync('git', ['add', '.gitignore', 'package.json', 'scripts/run-update.mjs', 'README.md', 'data/gpt-image-2-prompts.json', 'data/download-report.json', 'images/prompts'], { stdio: 'inherit' });
    execFileSync('git', ['commit', '-m', `data: add ${additions.length} GPT image prompts`], { stdio: 'inherit' });
    execFileSync('git', ['push', 'origin', 'main'], { stdio: 'inherit' });
  } else if (SHOULD_PUSH) {
    console.log('No new prompts; skipping commit and push.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
