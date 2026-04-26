'use strict';

// schedulerService — stub for future cron-based scheduled deployments
const timers = new Map();

function scheduleRebuild(appId, cronExpression, callback) {
  // Future: use node-cron or similar
  timers.set(appId, { cronExpression, callback });
}

function cancelSchedule(appId) {
  timers.delete(appId);
}

function listSchedules() {
  return Array.from(timers.entries()).map(([id, v]) => ({ appId: id, cron: v.cronExpression }));
}

module.exports = { scheduleRebuild, cancelSchedule, listSchedules };
