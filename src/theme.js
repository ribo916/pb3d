(function () {
  var STORAGE_KEY = 'pb3d-menu-theme';
  var saved = window.localStorage.getItem(STORAGE_KEY) || 'cobalt';
  document.body.dataset.theme = saved;

  function syncLabels(name) {
    var label = name.toUpperCase();
    var nodes = document.querySelectorAll('.theme-pill-name');
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = label;
  }

  window.setTheme = function setTheme(name) {
    document.body.dataset.theme = name;
    window.localStorage.setItem(STORAGE_KEY, name);
    syncLabels(name);
  };

  document.addEventListener('DOMContentLoaded', function () {
    syncLabels(document.body.dataset.theme);
  });
})();
