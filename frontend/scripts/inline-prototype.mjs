import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const dist = resolve('dist-prototype');
let html = await readFile(resolve(dist, 'prototype.html'), 'utf8');
const script = html.match(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/);
const style = html.match(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/);
if (!script || !style) throw new Error('Expected one local JS entry and stylesheet.');
const local = path => resolve(dist, path.replace(/^\.\//, '').replace(/^\//, ''));
const js = (await readFile(local(script[1]), 'utf8')).replace(/<\/script/gi, '<\\/script');
const css = (await readFile(local(style[1]), 'utf8')).replace(/<\/style/gi, '<\\/style');
html = html.replace(script[0], () => `<script type="module">${js}</script>`).replace(style[0], () => `<style>${css}</style>`);
if (/<(?:script|link)\b[^>]*(?:src|href)="(?:https?:|\.\/assets\/|\/assets\/)/.test(html)) throw new Error('Unbundled dependencies remain.');
await mkdir('prototype', { recursive: true });
await writeFile('prototype/index.html', html);
console.log(`Offline React prototype: prototype/index.html (${Math.round(Buffer.byteLength(html) / 1024)} KiB)`);
