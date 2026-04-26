'use strict';

// reverseProxyService is a stub; extend to dynamically configure nginx/caddy
async function addRoute(safeName, port) {
  // Future: write nginx virtual host config and reload
}

async function removeRoute(safeName) {
  // Future: remove nginx virtual host config and reload
}

module.exports = { addRoute, removeRoute };
