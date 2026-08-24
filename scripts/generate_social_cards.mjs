#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(root, "public/social");

const cards = {
  en: {
    language: "ENGLISH",
    lines: ["Click & build with AI open models,", "on your computer."],
    directory: "Full Ollama model directory",
    fontFamily: 'Inter, "Helvetica Neue", Arial, sans-serif',
    fontSize: 65
  },
  ru: {
    language: "РУССКИЙ",
    lines: ["Выбирайте и создавайте", "с открытыми ИИ-моделями", "на своём компьютере."],
    directory: "Полный каталог моделей Ollama",
    fontFamily: '"Helvetica Neue", Arial, sans-serif',
    fontSize: 48
  },
  ko: {
    language: "한국어",
    lines: ["내 컴퓨터에서", "오픈 AI 모델을 클릭하고", "만들어 보세요."],
    directory: "Ollama 전체 모델 디렉터리",
    fontFamily: '"Apple SD Gothic Neo", "Noto Sans CJK KR", sans-serif',
    fontSize: 61
  },
  ja: {
    language: "日本語",
    lines: ["自分のコンピューターで、", "オープンAIモデルを", "クリックして作ろう。"],
    directory: "Ollama モデル完全カタログ",
    fontFamily: '"Hiragino Sans", "Noto Sans CJK JP", sans-serif',
    fontSize: 59
  },
  "zh-cn": {
    language: "简体中文",
    lines: ["在你的电脑上，点击并使用", "开放 AI 模型构建。"],
    directory: "完整的 Ollama 模型目录",
    fontFamily: '"PingFang SC", "Noto Sans CJK SC", sans-serif',
    fontSize: 65
  }
};

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function cardSvg(card) {
  const lineHeight = card.fontSize * 1.16;
  const firstLineY = card.lines.length === 3 ? 215 : 250;
  const headline = card.lines.map((line, index) => (
    `<text x="74" y="${firstLineY + index * lineHeight}" class="headline">${escapeXml(line)}</text>`
  )).join("\n");

  return `
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="accentFade" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#91f25b" stop-opacity="0.23"/>
      <stop offset="1" stop-color="#91f25b" stop-opacity="0"/>
    </linearGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#2a2e28" stroke-width="1"/>
    </pattern>
    <style>
      .sans { font-family: ${card.fontFamily}; }
      .mono { font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; }
      .headline { font-family: ${card.fontFamily}; font-size: ${card.fontSize}px; font-weight: 760; fill: #fbfaf7; }
    </style>
  </defs>
  <rect width="1200" height="630" fill="#10110f"/>
  <rect width="1200" height="630" fill="url(#grid)" opacity="0.55"/>
  <circle cx="1070" cy="60" r="340" fill="url(#accentFade)"/>
  <path d="M0 0H1200V8H0Z" fill="#91f25b"/>
  <g class="sans">
    <text x="74" y="98" font-size="35" font-weight="850" letter-spacing="-1.5" fill="#fbfaf7">ailocal<tspan fill="#9ca195" font-weight="650">.click</tspan></text>
    <rect x="970" y="59" width="156" height="52" rx="26" fill="none" stroke="#596055" stroke-width="2"/>
    <text x="1048" y="92" text-anchor="middle" font-size="15" font-weight="760" letter-spacing="1.3" fill="#cbd0c6">${escapeXml(card.language)}</text>
    ${headline}
    <text x="76" y="476" font-size="20" font-weight="650" fill="#aeb4aa">${escapeXml(card.directory)}  ·  Mac  ·  Windows  ·  Linux</text>
  </g>
  <g transform="translate(74 518)">
    <rect width="1052" height="72" rx="12" fill="#080906" stroke="#383d35" stroke-width="2"/>
    <circle cx="27" cy="24" r="5" fill="#91f25b"/>
    <text x="28" y="48" class="mono" font-size="20" font-weight="700" fill="#91f25b">$</text>
    <text x="58" y="48" class="mono" font-size="20" font-weight="650" fill="#f4f3ed">ollama run <tspan fill="#91f25b">gemma4</tspan></text>
    <text x="1022" y="46" text-anchor="end" class="mono" font-size="15" fill="#858b81">ailocalclick.pages.dev</text>
  </g>
</svg>`;
}

await fs.mkdir(outputDirectory, { recursive: true });
for (const [locale, card] of Object.entries(cards)) {
  const output = path.join(outputDirectory, `ailocalclick-${locale}-v1.png`);
  await sharp(Buffer.from(cardSvg(card)))
    .resize(1200, 630)
    .png({ compressionLevel: 9 })
    .toFile(output);
  console.log(`Generated ${path.relative(root, output)}`);
}
