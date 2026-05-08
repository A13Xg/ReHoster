'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const requireAuth = require('../middleware/requireAuth');
const appService = require('../services/appService');
const logService = require('../services/logService');
const config = require('../config/env');
const { safeJoin } = require('../utils/paths');

const router = express.Router();

const MAX_EDIT_FILE_BYTES = 50 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.jsonc', '.yml', '.yaml', '.toml', '.ini', '.env',
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.css', '.scss', '.sass', '.less', '.html', '.htm',
  '.xml', '.svg', '.sql', '.py', '.rb', '.php', '.java', '.c', '.h', '.cpp', '.hpp', '.cs', '.go',
  '.rs', '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd', '.dockerfile', '.conf', '.config', '.ejs',
]);

function normalizeRelPath(inputPath) {
  return String(inputPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function isTextFilePath(filePath) {
  const lowerBase = path.basename(filePath).toLowerCase();
  if (lowerBase === 'dockerfile' || lowerBase === '.env') return true;
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;

  try {
    const handle = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(2048);
    const bytesRead = fs.readSync(handle, buffer, 0, buffer.length, 0);
    fs.closeSync(handle);
    for (let i = 0; i < bytesRead; i += 1) {
      if (buffer[i] === 0) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function sanitizeNewName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  if (trimmed === '.' || trimmed === '..') return null;
  if (trimmed.includes('/') || trimmed.includes('\\')) return null;
  return trimmed;
}

router.use(requireAuth);

router.get('/admin/apps/new', (req, res) => {
  const groups = appService.getAllGroups();
  res.render('apps/new', {
    title: 'Deploy New App',
    error: null,
    groups,
    defaultContainerPort: config.defaultContainerPort,
    formData: {},
  });
});

router.post('/admin/apps', async (req, res, next) => {
  try {
    const app = await appService.createApp(req.body);
    appService.deployApp(app.id).catch((err) => {
      logService.addLog(app.id, 'error', `Background deploy failed: ${err.message}`);
      console.error(`Background deploy error for app ${app.id}:`, err.message);
    });
    res.redirect(`/admin/apps/${app.id}`);
  } catch (err) {
    const groups = appService.getAllGroups();
    res.render('apps/new', {
      title: 'Deploy New App',
      error: err.message,
      groups,
      defaultContainerPort: config.defaultContainerPort,
      formData: req.body || {},
    });
  }
});

router.get('/admin/apps/:id', async (req, res, next) => {
  try {
    const app = await appService.syncAppStatusWithDocker(Number(req.params.id));
    if (!app) return res.status(404).render('error', { title: 'Not Found', status: 404, message: 'App not found', stack: null });
    const logs = require('../services/logService').getAppLogs(app.id, 50);
    let frameworks = [];
    try { frameworks = app.detected_frameworks ? JSON.parse(app.detected_frameworks) : []; } catch {}
    const groups = appService.getAllGroups();
    const group = groups.find((g) => g.id === app.group_id) || null;
    const envVarsText = appService.getEnvVarsTextForApp(app);
    const webhookUrl = appService.getWebhookUrlForApp(app);
    const envUpdated = String(req.query.envUpdated || '') === '1';
    const envApplyNow = String(req.query.envApplyNow || '') === '1';
    const detailsUpdated = String(req.query.detailsUpdated || '') === '1';
    const detailsRedeploy = String(req.query.detailsRedeploy || '') === '1';
    const detailsError = String(req.query.detailsError || '').trim();
    res.render('apps/show', {
      title: app.name,
      app,
      logs,
      baseHost: config.baseHost,
      frameworks,
      groups,
      group,
      envVarsText,
      webhookUrl,
      envUpdated,
      envApplyNow,
      detailsUpdated,
      detailsRedeploy,
      detailsError,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/admin/apps/:id/details', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    appService.updateAppDetails(id, req.body || {});

    appService.rebuildApp(id).catch((err) => {
      logService.addLog(id, 'error', `Background redeploy after details update failed: ${err.message}`);
      console.error(`Background redeploy after details update failed for app ${id}:`, err.message);
    });

    return res.redirect(`/admin/apps/${id}?detailsUpdated=1&detailsRedeploy=1`);
  } catch (err) {
    const id = Number(req.params.id);
    const message = encodeURIComponent(err.message || 'Failed to update app details');
    if (Number.isInteger(id) && id > 0) {
      return res.redirect(`/admin/apps/${id}?detailsError=${message}`);
    }
    return next(err);
  }
});

router.post('/admin/apps/:id/env', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const applyNow = String(req.body.applyNow || '') === '1';
    appService.updateAppEnvVars(id, req.body.envVars || '');

    if (applyNow) {
      appService.rebuildApp(id).catch((err) => {
        logService.addLog(id, 'error', `Background env apply rebuild failed: ${err.message}`);
        console.error(`Background env apply rebuild error for app ${id}:`, err.message);
      });
    }

    return res.redirect(`/admin/apps/${id}?envUpdated=1${applyNow ? '&envApplyNow=1' : ''}`);
  } catch (err) {
    next(err);
  }
});

router.post('/admin/apps/:id/start', async (req, res, next) => {
  try {
    await appService.startApp(Number(req.params.id));
    res.redirect(`/admin/apps/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

router.post('/admin/apps/:id/stop', async (req, res, next) => {
  try {
    await appService.stopApp(Number(req.params.id));
    res.redirect(`/admin/apps/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

router.post('/admin/apps/:id/restart', async (req, res, next) => {
  try {
    await appService.restartApp(Number(req.params.id));
    res.redirect(`/admin/apps/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

router.post('/admin/apps/:id/rebuild', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    appService.rebuildApp(id).catch((err) => {
      logService.addLog(id, 'error', `Background rebuild failed: ${err.message}`);
      console.error(`Background rebuild error for app ${id}:`, err.message);
    });
    res.redirect(`/admin/apps/${id}`);
  } catch (err) {
    next(err);
  }
});

router.post('/admin/apps/:id/pull', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    appService.pullAndRedeploy(id).catch((err) => {
      logService.addLog(id, 'error', `Background pull+redeploy failed: ${err.message}`);
      console.error(`Background pull+redeploy error for app ${id}:`, err.message);
    });
    res.redirect(`/admin/apps/${id}`);
  } catch (err) {
    next(err);
  }
});

router.get('/admin/apps/:id/logs', async (req, res, next) => {
  try {
    const app = appService.getApp(Number(req.params.id));
    if (!app) return res.status(404).render('error', { title: 'Not Found', status: 404, message: 'App not found', stack: null });
    const { dbLogs, dockerLogs } = await appService.getAppLogs(app.id);
    res.render('apps/logs', {
      title: `Logs — ${app.name}`,
      app,
      dbLogs,
      dockerLogs,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/admin/apps/:id/logs/data', async (req, res, next) => {
  try {
    const app = appService.getApp(Number(req.params.id));
    if (!app) return res.status(404).json({ error: 'Not found' });
    const sinceId = Number(req.query.since || 0);
    const { dockerLogs } = await appService.getAppLogs(app.id);
    const dbLogs = Number.isFinite(sinceId) && sinceId > 0
      ? logService.getAppLogsSince(app.id, sinceId, 200)
      : logService.getAppLogs(app.id, 200).slice().reverse();
    return res.json({
      id: app.id,
      status: app.status,
      dbLogs,
      dockerLogs,
    });
  } catch (err) {
    next(err);
  }
});

// File browser
router.get('/admin/apps/:id/files', (req, res, next) => {
  try {
    const app = appService.getApp(Number(req.params.id));
    if (!app) return res.status(404).render('error', { title: 'Not Found', status: 404, message: 'App not found', stack: null });
    if (!app.local_path || !fs.existsSync(app.local_path)) {
      return res.render('apps/files', { title: `Files — ${app.name}`, app, entries: [], currentRelPath: '' });
    }

    const relPath = normalizeRelPath(req.query.path);
    let browsePath;
    try {
      browsePath = relPath ? safeJoin(app.local_path, relPath) : app.local_path;
    } catch {
      return res.status(400).render('error', { title: 'Bad Request', status: 400, message: 'Invalid path', stack: null });
    }

    if (!fs.existsSync(browsePath) || !fs.statSync(browsePath).isDirectory()) {
      return res.redirect(`/admin/apps/${app.id}/files`);
    }

    const rawEntries = fs.readdirSync(browsePath);
    const entries = rawEntries
      .map((name) => {
        const fullPath = path.join(browsePath, name);
        const stat = fs.statSync(fullPath);
        const isText = !stat.isDirectory() && isTextFilePath(fullPath);
        return {
          name,
          isDir: stat.isDirectory(),
          size: stat.size,
          canEdit: !stat.isDirectory() && isText && stat.size <= MAX_EDIT_FILE_BYTES,
          relPath: relPath ? `${relPath}/${name}` : name,
        };
      })
      .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));

    res.render('apps/files', { title: `Files — ${app.name}`, app, entries, currentRelPath: relPath });
  } catch (err) {
    next(err);
  }
});

// View file content
router.get('/admin/apps/:id/files/view', (req, res, next) => {
  try {
    const app = appService.getApp(Number(req.params.id));
    if (!app || !app.local_path) return res.status(404).json({ error: 'Not found' });
    const relPath = normalizeRelPath(req.query.path);
    if (!relPath) return res.status(400).json({ error: 'Path required' });
    let filePath;
    try {
      filePath = safeJoin(app.local_path, relPath);
    } catch {
      return res.status(400).json({ error: 'Invalid path' });
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return res.status(404).json({ error: 'File not found' });
    }
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_EDIT_FILE_BYTES) return res.status(413).json({ error: 'File too large to edit (>50MB)' });
    if (!isTextFilePath(filePath)) return res.status(415).json({ error: 'Only text-based files can be edited' });
    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ content, path: relPath });
  } catch (err) {
    next(err);
  }
});

// Save file content
router.post('/admin/apps/:id/files/save', express.json(), (req, res, next) => {
  try {
    const app = appService.getApp(Number(req.params.id));
    if (!app || !app.local_path) return res.status(404).json({ error: 'Not found' });
    const relPath = normalizeRelPath(req.body.path);
    if (!relPath) return res.status(400).json({ error: 'Path required' });
    let filePath;
    try {
      filePath = safeJoin(app.local_path, relPath);
    } catch {
      return res.status(400).json({ error: 'Invalid path' });
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return res.status(404).json({ error: 'File not found' });
    }
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_EDIT_FILE_BYTES) return res.status(413).json({ error: 'File too large to edit (>50MB)' });
    if (!isTextFilePath(filePath)) return res.status(415).json({ error: 'Only text-based files can be edited' });
    const content = String(req.body.content || '');
    fs.writeFileSync(filePath, content, 'utf8');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/admin/apps/:id/files/download', (req, res, next) => {
  try {
    const app = appService.getApp(Number(req.params.id));
    if (!app || !app.local_path) return res.status(404).json({ error: 'Not found' });
    const relPath = normalizeRelPath(req.query.path);
    if (!relPath) return res.status(400).json({ error: 'Path required' });

    let filePath;
    try {
      filePath = safeJoin(app.local_path, relPath);
    } catch {
      return res.status(400).json({ error: 'Invalid path' });
    }

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return res.status(404).json({ error: 'File not found' });
    }

    return res.download(filePath, path.basename(filePath));
  } catch (err) {
    next(err);
  }
});

router.post('/admin/apps/:id/files/rename', express.json(), (req, res, next) => {
  try {
    const app = appService.getApp(Number(req.params.id));
    if (!app || !app.local_path) return res.status(404).json({ error: 'Not found' });

    const relPath = normalizeRelPath(req.body.path);
    const newName = sanitizeNewName(req.body.newName);
    if (!relPath) return res.status(400).json({ error: 'Path required' });
    if (!newName) return res.status(400).json({ error: 'Valid newName required' });

    const parentRel = relPath.includes('/') ? relPath.split('/').slice(0, -1).join('/') : '';
    const newRelPath = parentRel ? `${parentRel}/${newName}` : newName;

    let sourcePath;
    let destinationPath;
    try {
      sourcePath = safeJoin(app.local_path, relPath);
      destinationPath = safeJoin(app.local_path, newRelPath);
    } catch {
      return res.status(400).json({ error: 'Invalid path' });
    }

    if (!fs.existsSync(sourcePath)) return res.status(404).json({ error: 'Source not found' });
    if (fs.existsSync(destinationPath)) return res.status(409).json({ error: 'Destination already exists' });

    fs.renameSync(sourcePath, destinationPath);
    return res.json({ ok: true, path: newRelPath });
  } catch (err) {
    next(err);
  }
});

router.post('/admin/apps/:id/files/create', express.json(), (req, res, next) => {
  try {
    const app = appService.getApp(Number(req.params.id));
    if (!app || !app.local_path) return res.status(404).json({ error: 'Not found' });

    const parentPath = normalizeRelPath(req.body.parentPath);
    const name = sanitizeNewName(req.body.name);
    const type = String(req.body.type || '').toLowerCase();
    if (!name) return res.status(400).json({ error: 'Valid name required' });
    if (type !== 'file' && type !== 'folder') return res.status(400).json({ error: 'type must be file or folder' });

    const targetRelPath = parentPath ? `${parentPath}/${name}` : name;

    let targetPath;
    try {
      targetPath = safeJoin(app.local_path, targetRelPath);
    } catch {
      return res.status(400).json({ error: 'Invalid path' });
    }

    if (fs.existsSync(targetPath)) return res.status(409).json({ error: 'Already exists' });

    if (type === 'folder') {
      fs.mkdirSync(targetPath, { recursive: true });
    } else {
      fs.writeFileSync(targetPath, '', 'utf8');
    }

    return res.json({ ok: true, path: targetRelPath });
  } catch (err) {
    next(err);
  }
});

router.post('/admin/apps/:id/files/paste', express.json(), (req, res, next) => {
  try {
    const app = appService.getApp(Number(req.params.id));
    if (!app || !app.local_path) return res.status(404).json({ error: 'Not found' });

    const sourceRelPath = normalizeRelPath(req.body.sourcePath);
    const destinationRelPath = normalizeRelPath(req.body.destinationPath);
    if (!sourceRelPath) return res.status(400).json({ error: 'sourcePath required' });

    let sourcePath;
    let destinationDir;
    try {
      sourcePath = safeJoin(app.local_path, sourceRelPath);
      destinationDir = destinationRelPath ? safeJoin(app.local_path, destinationRelPath) : app.local_path;
    } catch {
      return res.status(400).json({ error: 'Invalid path' });
    }

    if (!fs.existsSync(sourcePath)) return res.status(404).json({ error: 'Source not found' });
    if (!fs.existsSync(destinationDir) || !fs.statSync(destinationDir).isDirectory()) {
      return res.status(404).json({ error: 'Destination folder not found' });
    }

    const sourceStat = fs.statSync(sourcePath);
    const targetName = path.basename(sourcePath);
    const targetPath = path.join(destinationDir, targetName);
    const targetRelPath = destinationRelPath ? `${destinationRelPath}/${targetName}` : targetName;

    if (fs.existsSync(targetPath)) return res.status(409).json({ error: 'Target already exists' });

    if (sourceStat.isDirectory()) {
      const resolvedSource = path.resolve(sourcePath);
      const resolvedTarget = path.resolve(targetPath);
      if (resolvedTarget.startsWith(resolvedSource + path.sep)) {
        return res.status(400).json({ error: 'Cannot paste a folder into itself' });
      }
      fs.cpSync(sourcePath, targetPath, { recursive: true, force: false, errorOnExist: true });
    } else {
      fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
    }

    return res.json({ ok: true, path: targetRelPath });
  } catch (err) {
    next(err);
  }
});

// Upload a file into the app's directory.
// The client sends a raw binary body with:
//   Content-Type: application/octet-stream
//   X-File-Name: <filename> (used to determine where to write)
//   X-File-Path: <relative directory path> (destination folder, optional)
router.post(
  '/admin/apps/:id/files/upload',
  express.raw({ type: 'application/octet-stream', limit: '100mb' }),
  (req, res, next) => {
    try {
      const app = appService.getApp(Number(req.params.id));
      if (!app || !app.local_path) return res.status(404).json({ error: 'Not found' });

      const rawName = req.headers['x-file-name'];
      // HTTP headers can theoretically arrive as an array (multi-value) — take the first.
      const headerName = Array.isArray(rawName) ? rawName[0] : rawName;
      const newName = sanitizeNewName(headerName);
      if (!newName) return res.status(400).json({ error: 'Valid X-File-Name header required' });

      const rawDirHeader = req.headers['x-file-path'];
      const headerDir = Array.isArray(rawDirHeader) ? rawDirHeader[0] : (rawDirHeader || '');
      const rawDir = normalizeRelPath(headerDir);
      const targetRelPath = rawDir ? `${rawDir}/${newName}` : newName;

      let targetPath;
      try {
        targetPath = rawDir ? safeJoin(app.local_path, `${rawDir}/${newName}`) : safeJoin(app.local_path, newName);
      } catch {
        return res.status(400).json({ error: 'Invalid path' });
      }

      const targetDir = path.dirname(targetPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      // req.body is a Buffer when express.raw() processes the request.
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      fs.writeFileSync(targetPath, body);

      return res.json({ ok: true, path: targetRelPath, size: body.length });
    } catch (err) {
      next(err);
    }
  }
);

router.delete('/admin/apps/:id', async (req, res, next) => {
  try {
    await appService.deleteApp(Number(req.params.id));
    res.redirect('/admin/apps');
  } catch (err) {
    next(err);
  }
});

router.get('/admin/apps/:id/status', async (req, res, next) => {
  try {
    const app = await appService.syncAppStatusWithDocker(Number(req.params.id));
    if (!app) return res.status(404).json({ error: 'Not found' });
    return res.json({ id: app.id, status: app.status });
  } catch (err) {
    next(err);
  }
});

router.post('/admin/apps/:id/delete', async (req, res, next) => {
  try {
    await appService.deleteApp(Number(req.params.id));
    res.redirect('/admin/apps');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
