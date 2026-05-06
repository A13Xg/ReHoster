'use strict';

const fs = require('fs');
const { runCommand } = require('../utils/shell');
const db = require('../config/db');

function readProcMeminfo() {
  try {
    const content = fs.readFileSync('/proc/meminfo', 'utf8');
    const lines = content.split('\n');
    const get = (key) => {
      const line = lines.find((l) => l.startsWith(key + ':'));
      if (!line) return 0;
      return parseInt(line.split(/\s+/)[1], 10) || 0;
    };
    const totalKb = get('MemTotal');
    const availKb = get('MemAvailable');
    return { memTotalMb: Math.round(totalKb / 1024), memUsedMb: Math.round((totalKb - availKb) / 1024) };
  } catch { return { memTotalMb: 0, memUsedMb: 0 }; }
}

function readLoadAvg() {
  try {
    const content = fs.readFileSync('/proc/loadavg', 'utf8');
    const parts = content.trim().split(' ');
    return parseFloat(parts[0]) || 0;
  } catch { return 0; }
}

async function getDiskUsage() {
  try {
    const result = await runCommand('df', ['-BG', '--output=used,size', '/'], { timeout: 5000 });
    const lines = result.stdout.trim().split('\n');
    if (lines.length < 2) return { diskUsedGb: 0, diskTotalGb: 0 };
    const parts = lines[1].trim().split(/\s+/);
    return {
      diskUsedGb: parseFloat(String(parts[0]).replace(/[^0-9.]/g, '')) || 0,
      diskTotalGb: parseFloat(String(parts[1]).replace(/[^0-9.]/g, '')) || 0,
    };
  } catch { return { diskUsedGb: 0, diskTotalGb: 0 }; }
}

async function collectSystemMetrics() {
  const { memTotalMb, memUsedMb } = readProcMeminfo();
  const cpuLoad = readLoadAvg();
  const { diskUsedGb, diskTotalGb } = await getDiskUsage();
  const cpuPercent = Math.min(100, Math.round(cpuLoad * 100));
  db.prepare('INSERT INTO system_metrics (timestamp, cpu_percent, mem_used_mb, mem_total_mb, disk_used_gb, disk_total_gb) VALUES (CURRENT_TIMESTAMP, ?, ?, ?, ?, ?)').run(cpuPercent, memUsedMb, memTotalMb, diskUsedGb, diskTotalGb);
  db.prepare("DELETE FROM system_metrics WHERE timestamp < datetime('now', '-7 days')").run();
  return { cpuPercent, memUsedMb, memTotalMb, diskUsedGb, diskTotalGb };
}

async function collectAppMetrics(appId, containerName) {
  try {
    const result = await runCommand('docker', ['stats', '--no-stream', '--format', '{{json .}}', containerName], { timeout: 10000 });
    if (result.exitCode !== 0 || !result.stdout.trim()) return null;
    const data = JSON.parse(result.stdout.trim());
    const memMatch = (data.MemUsage || '').match(/([\d.]+)(\w+)/);
    let memMb = 0;
    if (memMatch) {
      const val = parseFloat(memMatch[1]);
      const unit = memMatch[2].toLowerCase();
      if (unit.startsWith('gi')) memMb = Math.round(val * 1024);
      else if (unit.startsWith('mi')) memMb = Math.round(val);
      else if (unit.startsWith('ki')) memMb = Math.round(val / 1024);
    }
    const cpuStr = data.CPUPerc || '0%';
    const cpuPct = parseFloat(cpuStr) || 0;
    db.prepare('INSERT INTO system_metrics (timestamp, cpu_percent, mem_used_mb, mem_total_mb, app_id) VALUES (CURRENT_TIMESTAMP, ?, ?, 0, ?)').run(Math.round(cpuPct), memMb, appId);
    return { cpuPercent: Math.round(cpuPct), memUsedMb: memMb };
  } catch { return null; }
}

function getMetricsSummary() {
  const systemMetrics = db.prepare("SELECT * FROM system_metrics WHERE app_id IS NULL ORDER BY timestamp DESC LIMIT 60").all();
  const appMetrics = db.prepare("SELECT app_id, AVG(cpu_percent) as avg_cpu, AVG(mem_used_mb) as avg_mem FROM system_metrics WHERE app_id IS NOT NULL AND timestamp > datetime('now', '-1 hour') GROUP BY app_id").all();
  return { systemMetrics, appMetrics };
}

function getMetricsTimeseries(secondsBack = 3600) {
  const metrics = db.prepare(`
    SELECT 
      strftime('%Y-%m-%dT%H:%M:%S', timestamp) as time,
      timestamp,
      cpu_percent,
      mem_used_mb,
      mem_total_mb,
      disk_used_gb,
      disk_total_gb
    FROM system_metrics 
    WHERE app_id IS NULL 
      AND timestamp > datetime('now', '-${Math.round(secondsBack)}seconds')
    ORDER BY timestamp ASC
  `).all();
  
  return {
    times: metrics.map(m => m.time),
    timestamps: metrics.map(m => m.timestamp),
    cpu: metrics.map(m => m.cpu_percent),
    memUsed: metrics.map(m => m.mem_used_mb),
    memTotal: metrics.length > 0 ? metrics[0].mem_total_mb : 0,
    diskUsed: metrics.map(m => m.disk_used_gb),
    diskTotal: metrics.length > 0 ? metrics[0].disk_total_gb : 0,
  };
}

module.exports = { collectSystemMetrics, collectAppMetrics, getMetricsSummary, getMetricsTimeseries };
