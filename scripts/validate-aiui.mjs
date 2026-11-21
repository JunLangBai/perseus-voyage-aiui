import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const requiredFiles = [
  'AGENTS.md',
  'app.json',
  'app.js',
  'package.json',
  'pages/index/index.ink',
  'styles/app.css',
  'interaction/gaze.js',
  'interaction/temple.js',
];
const allowedTags = new Set([
  'page',
  'view',
  'text',
  'button',
  'scroll-view',
]);
const failures = [];

function fail(message) {
  failures.push(message);
}

function assertFile(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) fail(`missing file: ${relativePath}`);
  return absolutePath;
}

function checkJavaScript(relativePath) {
  const absolutePath = assertFile(relativePath);
  if (!existsSync(absolutePath)) return;
  const result = spawnSync(process.execPath, ['--check', absolutePath], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    fail(`JavaScript syntax error in ${relativePath}\n${result.stderr || result.stdout}`);
  }
}

requiredFiles.forEach(assertFile);

let appConfig = null;
try {
  appConfig = JSON.parse(readFileSync(path.join(root, 'app.json'), 'utf8'));
} catch (error) {
  fail(`app.json is invalid: ${error.message}`);
}

for (const route of appConfig?.pages || []) {
  const inkPath = path.join(root, `${route}.ink`);
  const multiFilePaths = ['json', 'wxml', 'wxss', 'js']
    .map((extension) => path.join(root, `${route}.${extension}`));
  const hasInk = existsSync(inkPath);
  const hasAllMultiFiles = multiFilePaths.every((filePath) => existsSync(filePath));
  if (hasInk === hasAllMultiFiles) {
    fail(`Page ${route} must resolve to exactly one source form`);
  }
}

const inkRelativePath = 'pages/index/index.ink';
const inkPath = path.join(root, inkRelativePath);
const ink = readFileSync(inkPath, 'utf8');
const defMatch = ink.match(/<script def>\s*([\s\S]*?)\s*<\/script>/);
const setupMatch = ink.match(/<script setup>\s*([\s\S]*?)\s*<\/script>/);
const pageMatch = ink.match(/<page>([\s\S]*?)<\/page>/);
const styleMatch = ink.match(/<style>\s*([\s\S]*?)\s*<\/style>/);

if (!defMatch) fail('missing <script def>');
if (!setupMatch) fail('missing <script setup>');
if (!pageMatch) fail('missing <page> root');
if (!styleMatch) fail('missing <style>');
if ((ink.match(/<page>/g) || []).length !== 1) fail('expected exactly one <page> root');
if ((ink.match(/<widget>/g) || []).length !== 0) fail('Page file must not contain <widget>');

if (defMatch) {
  try {
    JSON.parse(defMatch[1]);
  } catch (error) {
    fail(`<script def> is invalid JSON: ${error.message}`);
  }
}

if (setupMatch) {
  const syntax = spawnSync(
    process.execPath,
    ['--check', '--input-type=module'],
    { input: setupMatch[1], encoding: 'utf8' },
  );
  if (syntax.status !== 0) {
    fail(`<script setup> syntax error\n${syntax.stderr || syntax.stdout}`);
  }

  const importPattern = /from\s+['"]([^'"]+)['"]/g;
  for (const match of setupMatch[1].matchAll(importPattern)) {
    const importPath = match[1];
    if (!importPath.startsWith('.')) continue;
    const resolved = path.resolve(path.dirname(inkPath), importPath);
    if (!existsSync(resolved)) fail(`unresolved import: ${importPath}`);
  }
}

if (pageMatch) {
  const tags = new Set(
    [...pageMatch[1].matchAll(/<([a-z][a-z0-9-]*)\b/g)].map((match) => match[1]),
  );
  for (const tag of tags) {
    if (!allowedTags.has(tag)) fail(`unsupported or undeclared component tag: <${tag}>`);
  }

  const handlerPattern = /\b(?:bind|catch)[a-z]+="([A-Za-z_$][\w$]*)"/g;
  for (const match of pageMatch[1].matchAll(handlerPattern)) {
    const handler = match[1];
    const declaration = new RegExp(`\\n  ${handler}\\s*\\(`);
    if (!declaration.test(setupMatch?.[1] || '')) {
      fail(`template handler is missing from the Page object: ${handler}`);
    }
  }
}

if (styleMatch) {
  const importPattern = /@import\s+["']([^"']+)["']/g;
  for (const match of styleMatch[1].matchAll(importPattern)) {
    const importPath = match[1];
    const resolved = importPath.startsWith('/')
      ? path.resolve(root, `.${importPath}`)
      : path.resolve(path.dirname(inkPath), importPath);
    if (!existsSync(resolved)) fail(`unresolved style import: ${match[1]}`);
  }
}

const appStyles = readFileSync(path.join(root, 'styles', 'app.css'), 'utf8');
const appShellRule = appStyles.match(/\.app-shell\s*\{([\s\S]*?)\}/)?.[1] || '';
if (/width:\s*480px/.test(appShellRule) || /height:\s*352px/.test(appShellRule)) {
  fail('app-shell must use the device viewport instead of fixed 480x352 dimensions');
}
if (!/<scroll-view[^>]+class="viewport"/.test(ink)) {
  fail('the main viewport must use scroll-view for smaller device surfaces');
}
if (!/onKeyDown\(event\)/.test(setupMatch?.[1] || '') || !/onKeyUp\(event\)/.test(setupMatch?.[1] || '')) {
  fail('Page must implement onKeyDown and onKeyUp for temple gestures');
}
for (const handler of ['scheduleSingleTap', 'applyTempleIntent']) {
  if (!new RegExp(`\\n  ${handler}\\(`).test(setupMatch?.[1] || '')) {
    fail(`missing temple gesture handler: ${handler}`);
  }
}

if (/\b(?:App|Page|Widget)\s*\(/.test(ink)) {
  fail('legacy registration call found in .ink source');
}
if (/"workers"\s*:/.test(readFileSync(path.join(root, 'app.json'), 'utf8'))) {
  fail('legacy "workers" field found; use "agentWorkers"');
}

function collectJavaScript(directory) {
  return readdirSync(directory)
    .flatMap((name) => {
      if (name.startsWith('.')) return [];
      const absolutePath = path.join(directory, name);
      if (statSync(absolutePath).isDirectory()) {
        if (['node_modules', '.agents', 'output'].includes(name)) return [];
        return collectJavaScript(absolutePath);
      }
      return name.endsWith('.js') || name.endsWith('.mjs')
        ? [absolutePath]
        : [];
    });
}

collectJavaScript(root).forEach((filePath) => {
  const relativePath = path.relative(root, filePath).replaceAll('\\', '/');
  checkJavaScript(relativePath);
});

if (failures.length > 0) {
  console.error('AIUI validation failed:');
  failures.forEach((message) => console.error(`- ${message}`));
  process.exitCode = 1;
} else {
  console.log(`AIUI validation passed: ${appConfig.pages.length} Page, ${collectJavaScript(root).length} JS modules checked.`);
}
