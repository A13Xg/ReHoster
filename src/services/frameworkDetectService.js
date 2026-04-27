'use strict';

const fs = require('fs');
const path = require('path');

const FRAMEWORKS = [
  { key: 'next', deps: ['next'], label: 'Next.js', color: '#000000' },
  { key: 'nuxt', deps: ['nuxt'], label: 'Nuxt', color: '#00dc82' },
  { key: 'gatsby', deps: ['gatsby'], label: 'Gatsby', color: '#663399' },
  { key: 'remix', deps: ['remix', '@remix-run/node', '@remix-run/react'], label: 'Remix', color: '#f44250' },
  { key: 'react', deps: ['react'], label: 'React', color: '#61dafb' },
  { key: 'vue', deps: ['vue'], label: 'Vue.js', color: '#42b883' },
  { key: 'angular', deps: ['@angular/core'], label: 'Angular', color: '#dd0031' },
  { key: 'svelte', deps: ['svelte'], label: 'Svelte', color: '#ff3e00' },
  { key: 'vite', deps: ['vite'], label: 'Vite', color: '#646cff' },
  { key: 'fastify', deps: ['fastify'], label: 'Fastify', color: '#00c7b7' },
  { key: 'express', deps: ['express'], label: 'Express', color: '#68d391' },
];

function detectFrameworks(appPath) {
  const pkgPath = path.join(appPath, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return [{ key: 'static', label: 'Static/HTML', color: '#f0db4f' }];
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    const detected = FRAMEWORKS.filter((f) => f.deps.some((d) => allDeps[d] !== undefined));
    if (detected.length === 0) return [{ key: 'nodejs', label: 'Node.js', color: '#68a063' }];
    return detected.map((f) => ({ key: f.key, label: f.label, color: f.color }));
  } catch {
    return [{ key: 'nodejs', label: 'Node.js', color: '#68a063' }];
  }
}

module.exports = { detectFrameworks };
