'use strict';

// Confirm dialogs for destructive actions
document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('.confirm-action').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      var message = btn.getAttribute('data-confirm') || 'Are you sure?';
      if (!confirm(message)) {
        e.preventDefault();
        return false;
      }
    });
  });

  // Highlight active nav item
  var path = window.location.pathname;
  document.querySelectorAll('.nav-item').forEach(function (link) {
    var href = link.getAttribute('href');
    if (href && path.startsWith(href) && href !== '/') {
      link.classList.add('active');
    }
  });
});

// Status polling: periodically refresh status badges on app listing/detail pages
(function () {
  var refreshInterval = null;

  function updateStatusBadges() {
    var cells = document.querySelectorAll('[data-app-id]');
    if (cells.length === 0) return;

    cells.forEach(function (row) {
      var appId = row.getAttribute('data-app-id');
      if (!appId) return;
      fetch('/admin/apps/' + appId + '/status', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (!data) return;
          var badge = row.querySelector('.badge');
          if (badge) {
            badge.className = 'badge badge-' + data.status;
            badge.textContent = data.status;
          }
        })
        .catch(function () {});
    });
  }

  // Only auto-poll if there are apps in a transitional state
  var transitionalBadges = document.querySelectorAll(
    '.badge-cloning, .badge-building, .badge-creating'
  );
  if (transitionalBadges.length > 0) {
    refreshInterval = setInterval(function () {
      updateStatusBadges();
      // Stop polling if no more transitional states
      var remaining = document.querySelectorAll(
        '.badge-cloning, .badge-building, .badge-creating'
      );
      if (remaining.length === 0) {
        clearInterval(refreshInterval);
        refreshInterval = null;
      }
    }, 3000);
  }
})();

// Form submit guard: disable button to prevent double-submit
document.addEventListener('DOMContentLoaded', function () {
  var deployForm = document.getElementById('deployForm');
  if (deployForm) {
    deployForm.addEventListener('submit', function () {
      var btn = document.getElementById('deployBtn');
      if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ Deploying…';
      }
    });
  }
});

// Client-side form validation for new app form
document.addEventListener('DOMContentLoaded', function () {
  var nameInput = document.getElementById('name');
  var repoInput = document.getElementById('repoUrl');

  if (nameInput) {
    nameInput.addEventListener('blur', function () {
      var val = nameInput.value.trim();
      if (val.length < 1) {
        nameInput.setCustomValidity('App name is required');
      } else if (val.length > 50) {
        nameInput.setCustomValidity('App name must be 50 characters or fewer');
      } else {
        nameInput.setCustomValidity('');
      }
    });
  }

  if (repoInput) {
    repoInput.addEventListener('blur', function () {
      var val = repoInput.value.trim();
      var valid = val.startsWith('https://github.com/') || val.startsWith('git@github.com:');
      if (!val) {
        repoInput.setCustomValidity('Repository URL is required');
      } else if (!valid) {
        repoInput.setCustomValidity('Must be a valid GitHub HTTPS (https://github.com/...) or SSH (git@github.com:...) URL');
      } else {
        repoInput.setCustomValidity('');
      }
    });
  }
});
