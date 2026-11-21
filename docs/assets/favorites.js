// Favorites: the heart on sale cards and sale pages. The list of sale ids
// lives in this browser only (localStorage). No account, no server, and a
// failed save is shown on the page instead of being swallowed.
(function () {
  'use strict';
  var KEY = 'dig-favorites';

  function list() {
    try {
      var raw = window.localStorage.getItem(KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(function (id) { return typeof id === 'string'; }) : [];
    } catch (error) {
      return [];
    }
  }

  function warn(message) {
    var note = document.getElementById('fav-warning');
    if (!note) {
      note = document.createElement('p');
      note.id = 'fav-warning';
      note.className = 'fav-warning';
      note.setAttribute('role', 'alert');
      document.body.appendChild(note);
    }
    note.textContent = message;
    note.hidden = false;
  }

  function save(ids) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(ids));
      var note = document.getElementById('fav-warning');
      if (note) note.hidden = true;
      return true;
    } catch (error) {
      warn('Your browser would not save favorites, so they will not be kept. Check private-browsing or storage settings.');
      return false;
    }
  }

  function paint(ids) {
    var favorites = ids || list();
    Array.prototype.forEach.call(document.querySelectorAll('[data-fav]'), function (button) {
      var on = favorites.indexOf(button.getAttribute('data-fav')) !== -1;
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
      var label = button.querySelector('[data-fav-label]');
      if (label) label.textContent = on ? 'Saved as favorite' : 'Save as favorite';
    });
    return favorites;
  }

  function announce(ids) {
    try {
      window.dispatchEvent(new CustomEvent('dig:favorites', {detail: ids.slice()}));
    } catch (error) { /* older browsers: the search page re-reads on toggle */ }
  }

  document.addEventListener('click', function (event) {
    var button = event.target.closest ? event.target.closest('[data-fav]') : null;
    if (!button) return;
    var id = button.getAttribute('data-fav');
    var ids = list();
    var at = ids.indexOf(id);
    if (at === -1) ids.push(id);
    else ids.splice(at, 1);
    paint(ids);
    if (save(ids)) announce(ids);
    else paint();
  });

  window.addEventListener('storage', function (event) {
    if (event.key === KEY) announce(paint());
  });

  window.DigFavorites = {list: list};
  paint();
})();
