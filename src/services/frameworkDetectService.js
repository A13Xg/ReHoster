'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Framework/language definitions for JavaScript/Node.js projects.
 * Each entry maps one or more npm dependency names to a framework descriptor.
 * Frameworks are checked against both `dependencies` and `devDependencies`
 * so build-time tools (vite, etc.) are also detected correctly.
 */
const NODE_FRAMEWORKS = [
  { key: 'next',     deps: ['next'],                                        label: 'Next.js',   color: '#000000' },
  { key: 'nuxt',     deps: ['nuxt'],                                        label: 'Nuxt',      color: '#00dc82' },
  { key: 'gatsby',   deps: ['gatsby'],                                      label: 'Gatsby',    color: '#663399' },
  { key: 'remix',    deps: ['remix', '@remix-run/node', '@remix-run/react'], label: 'Remix',     color: '#f44250' },
  { key: 'react',    deps: ['react'],                                        label: 'React',     color: '#61dafb' },
  { key: 'vue',      deps: ['vue'],                                          label: 'Vue.js',    color: '#42b883' },
  { key: 'angular',  deps: ['@angular/core'],                               label: 'Angular',   color: '#dd0031' },
  { key: 'svelte',   deps: ['svelte'],                                       label: 'Svelte',    color: '#ff3e00' },
  { key: 'vite',     deps: ['vite'],                                         label: 'Vite',      color: '#646cff' },
  { key: 'astro',    deps: ['astro'],                                        label: 'Astro',     color: '#ff5d01' },
  { key: 'fastify',  deps: ['fastify'],                                      label: 'Fastify',   color: '#00c7b7' },
  { key: 'express',  deps: ['express'],                                      label: 'Express',   color: '#68d391' },
  { key: 'hapi',     deps: ['@hapi/hapi'],                                   label: 'Hapi',      color: '#f3a128' },
  { key: 'nest',     deps: ['@nestjs/core'],                                 label: 'NestJS',    color: '#e0234e' },
  { key: 'koa',      deps: ['koa'],                                          label: 'Koa',       color: '#33333d' },
  { key: 'strapi',   deps: ['strapi', '@strapi/strapi'],                    label: 'Strapi',    color: '#4945ff' },
  { key: 'sveltekit', deps: ['@sveltejs/kit'],                              label: 'SvelteKit', color: '#ff3e00' },
  { key: 'qwik',     deps: ['@builder.io/qwik'],                            label: 'Qwik',      color: '#18b6f6' },
];

/**
 * Python framework/library signatures.
 * Each entry's `modules` list is checked against `requirements.txt`,
 * `pyproject.toml`, and `Pipfile` content (case-insensitive substring match).
 */
const PYTHON_FRAMEWORKS = [
  { key: 'django',   modules: ['django'],                    label: 'Django',   color: '#092e20' },
  { key: 'flask',    modules: ['flask'],                     label: 'Flask',    color: '#000000' },
  { key: 'fastapi',  modules: ['fastapi'],                   label: 'FastAPI',  color: '#009688' },
  { key: 'tornado',  modules: ['tornado'],                   label: 'Tornado',  color: '#e83e2c' },
  { key: 'aiohttp',  modules: ['aiohttp'],                   label: 'aiohttp',  color: '#2c5bb4' },
  { key: 'starlette', modules: ['starlette'],                label: 'Starlette', color: '#009688' },
  { key: 'pyramid',  modules: ['pyramid'],                   label: 'Pyramid',  color: '#c7793e' },
  { key: 'sanic',    modules: ['sanic'],                     label: 'Sanic',    color: '#ff0068' },
  { key: 'streamlit', modules: ['streamlit'],                label: 'Streamlit', color: '#ff4b4b' },
  { key: 'gradio',   modules: ['gradio'],                    label: 'Gradio',   color: '#f97316' },
];

/**
 * Read and concatenate all Python dependency manifest files that exist in the
 * given directory.  Returns a lowercase string suitable for substring searches.
 *
 * @param {string} appPath - Root directory of the application.
 * @returns {string}
 */
function readPythonManifestContent(appPath) {
  const candidates = ['requirements.txt', 'requirements-dev.txt', 'Pipfile', 'pyproject.toml'];
  let content = '';
  for (const fileName of candidates) {
    const filePath = path.join(appPath, fileName);
    if (fs.existsSync(filePath)) {
      try {
        content += '\n' + fs.readFileSync(filePath, 'utf8');
      } catch {
        // Skip unreadable files.
      }
    }
  }
  return content.toLowerCase();
}

/**
 * Detect the primary language/runtime of a project by inspecting well-known
 * indicator files.
 *
 * @param {string} appPath
 * @returns {'node' | 'python' | 'ruby' | 'php' | 'go' | 'rust' | 'java' | 'static'}
 */
function detectPrimaryLanguage(appPath) {
  if (fs.existsSync(path.join(appPath, 'package.json'))) return 'node';
  if (fs.existsSync(path.join(appPath, 'requirements.txt'))
      || fs.existsSync(path.join(appPath, 'pyproject.toml'))
      || fs.existsSync(path.join(appPath, 'Pipfile'))
      || fs.existsSync(path.join(appPath, 'setup.py'))
      || fs.existsSync(path.join(appPath, 'manage.py'))) {
    return 'python';
  }
  if (fs.existsSync(path.join(appPath, 'Gemfile'))) return 'ruby';
  if (fs.existsSync(path.join(appPath, 'composer.json'))) return 'php';
  if (fs.existsSync(path.join(appPath, 'go.mod'))) return 'go';
  if (fs.existsSync(path.join(appPath, 'Cargo.toml'))) return 'rust';
  if (fs.existsSync(path.join(appPath, 'pom.xml'))
      || fs.existsSync(path.join(appPath, 'build.gradle'))) {
    return 'java';
  }
  return 'static';
}

/**
 * Detect frameworks, libraries, and the primary language for an application.
 *
 * The returned array always contains at least one descriptor.  The `language`
 * field on the first entry exposes the primary runtime so that downstream
 * services (e.g. dockerService) can choose the right base image.
 *
 * @param {string} appPath - Root directory of the application.
 * @returns {Array<{ key: string, label: string, color: string, language?: string }>}
 *
 * @example
 * const frameworks = detectFrameworks('/managed-apps/my-api');
 * // => [{ key: 'express', label: 'Express', color: '#68d391', language: 'node' }]
 */
function detectFrameworks(appPath) {
  const language = detectPrimaryLanguage(appPath);

  // ── Python projects ──────────────────────────────────────────────────────
  if (language === 'python') {
    const manifestContent = readPythonManifestContent(appPath);
    const detected = PYTHON_FRAMEWORKS.filter((f) =>
      f.modules.some((mod) => manifestContent.includes(mod))
    );
    if (detected.length > 0) {
      return detected.map((f, i) => ({
        key: f.key,
        label: f.label,
        color: f.color,
        language: i === 0 ? 'python' : undefined,
      }));
    }
    return [{ key: 'python', label: 'Python', color: '#3776ab', language: 'python' }];
  }

  // ── Node.js projects ─────────────────────────────────────────────────────
  if (language === 'node') {
    const pkgPath = path.join(appPath, 'package.json');
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      const detected = NODE_FRAMEWORKS.filter((f) =>
        f.deps.some((d) => allDeps[d] !== undefined)
      );
      if (detected.length > 0) {
        return detected.map((f, i) => ({
          key: f.key,
          label: f.label,
          color: f.color,
          language: i === 0 ? 'node' : undefined,
        }));
      }
    } catch {
      // Malformed package.json — fall through to generic Node.js.
    }
    return [{ key: 'nodejs', label: 'Node.js', color: '#68a063', language: 'node' }];
  }

  // ── Other languages ───────────────────────────────────────────────────────
  const languageDescriptors = {
    ruby:   { key: 'ruby',   label: 'Ruby',   color: '#cc342d' },
    php:    { key: 'php',    label: 'PHP',    color: '#777bb4' },
    go:     { key: 'go',     label: 'Go',     color: '#00acd7' },
    rust:   { key: 'rust',   label: 'Rust',   color: '#f74c00' },
    java:   { key: 'java',   label: 'Java',   color: '#f89820' },
    static: { key: 'static', label: 'Static/HTML', color: '#f0db4f' },
  };

  const descriptor = languageDescriptors[language] || languageDescriptors.static;
  return [{ ...descriptor, language }];
}

/**
 * Return the primary language string for an already-detected framework array.
 * Falls back to 'node' so that the rest of the build pipeline behaves sensibly.
 *
 * @param {Array<{ language?: string }>} frameworks
 * @returns {string}
 */
function getPrimaryLanguage(frameworks) {
  if (!Array.isArray(frameworks) || frameworks.length === 0) return 'node';
  return frameworks[0].language || 'node';
}

module.exports = { detectFrameworks, detectPrimaryLanguage, getPrimaryLanguage };
