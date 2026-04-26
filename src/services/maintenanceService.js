'use strict';

const path = require('path');
const fs = require('fs');

function getMaintenanceHtml(settings) {
  const title = settings.maintenance_title || 'Under Maintenance';
  const message = settings.maintenance_message || 'This service is temporarily unavailable.';
  const bgColor = settings.maintenance_bg_color || '#1a1d27';
  const textColor = settings.maintenance_text_color || '#e4e6f0';

  const templatePath = path.join(__dirname, '../maintenance-site/index.html');
  if (fs.existsSync(templatePath)) {
    return fs.readFileSync(templatePath, 'utf8')
      .replace(/\{\{TITLE\}\}/g, title)
      .replace(/\{\{MESSAGE\}\}/g, message)
      .replace(/\{\{BG_COLOR\}\}/g, bgColor)
      .replace(/\{\{TEXT_COLOR\}\}/g, textColor);
  }

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${title}</title><style>body{background:${bgColor};color:${textColor};display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;margin:0;}</style></head><body><div style="text-align:center"><h1>${title}</h1><p>${message}</p></div></body></html>`;
}

module.exports = { getMaintenanceHtml };
