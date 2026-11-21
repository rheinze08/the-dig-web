// Search on /search/. The build writes every sale into the page; this hides the
// ones that do not match, using the search data file the build wrote beside it.
// Nothing is sent to a server. test/check.mjs and test/live.mjs load this same
// file in Node to prove what a search returns.
(function (root) {
  'use strict';

  // Lower case, no accents or apostrophes, single spaces. build.mjs folds text the same way.
  function fold(text) {
    return String(text == null ? '' : text).toLowerCase().normalize('NFKD')
      .replace(/[̀-ͯ]/g, '').replace(/['‘’]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // The words a sale can be found by: its title, its company, its categories,
  // and — when the feed carries them — its photo keywords and contents line.
  function prepare(data) {
    var labels = {};
    (data.categories || []).forEach(function (category) { labels[category.id] = category.label; });
    return (data.sales || []).map(function (sale) {
      var categories = sale.categories || [];
      var text = [sale.title, sale.company, sale.contentsLine || '']
        .concat(categories.map(function (id) { return labels[id] || id; }), sale.tags || [], sale.keywords || []).join(' ');
      return {sale: sale, words: fold(text).split(' '), categories: categories};
    });
  }

  // Every word typed must start a word of the sale. With categories chosen,
  // the sale must be in at least one of them. With favorites given (an array
  // of sale ids), only those sales match.
  function find(prepared, query, categories, favorites) {
    var terms = fold(query).split(' ').filter(Boolean);
    var chosen = categories || [];
    return prepared.filter(function (entry) {
      if (favorites && favorites.indexOf(entry.sale.id) === -1) return false;
      if (chosen.length && !chosen.some(function (id) { return entry.categories.indexOf(id) !== -1; })) return false;
      return terms.every(function (term) {
        return entry.words.some(function (word) { return word.lastIndexOf(term, 0) === 0; });
      });
    }).map(function (entry) { return entry.sale; });
  }

  var api = {fold: fold, prepare: prepare, find: find};
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  root.DigSearch = api;

  var form = document.getElementById('search-form');
  var results = document.getElementById('results');
  if (!form || !results) return;
  var input = document.getElementById('q');
  var countLine = document.getElementById('result-count');
  var nothing = document.getElementById('no-results');
  var status = document.getElementById('search-status');
  var clear = document.getElementById('clear-filters');
  var each = function (list, fn) { Array.prototype.forEach.call(list, fn); };
  var chips = Array.prototype.slice.call(form.querySelectorAll('.chip[data-cat]'));
  var groups = Array.prototype.slice.call(results.querySelectorAll('.search-group'));
  var hits = Array.prototype.slice.call(results.querySelectorAll('.hit[data-id]'));
  var total = hits.length;
  var cityCount = groups.length;
  var prepared = null;

  // The page was built for one day. Mark sales that have ended since, city by city.
  groups.forEach(function (group) {
    var today;
    try {
      var parts = new Intl.DateTimeFormat('en-US', {timeZone: group.getAttribute('data-time-zone'), year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date());
      var pick = function (type) { return parts.filter(function (part) { return part.type === type; })[0].value; };
      today = pick('year') + '-' + pick('month') + '-' + pick('day');
    } catch (error) {
      return;
    }
    if (today <= group.getAttribute('data-built-for')) return;
    each(group.querySelectorAll('.hit[data-last]'), function (hit) {
      if (hit.getAttribute('data-last') >= today || hit.classList.contains('is-ended')) return;
      hit.classList.add('is-ended');
      var dates = hit.querySelector('.dates');
      if (!dates) return;
      var tag = document.createElement('span');
      tag.className = 'tag tag-ended';
      tag.textContent = 'Ended';
      dates.appendChild(document.createTextNode(' '));
      dates.appendChild(tag);
    });
  });

  function chosen() {
    return chips.filter(function (chip) { return chip.getAttribute('aria-pressed') === 'true'; })
      .map(function (chip) { return chip.getAttribute('data-cat'); });
  }

  function sales(count) {
    return count + (count === 1 ? ' sale' : ' sales');
  }

  function setCount(shown, filtering) {
    var strong = document.createElement('strong');
    strong.textContent = String(shown);
    countLine.textContent = '';
    countLine.appendChild(strong);
    countLine.appendChild(document.createTextNode(filtering
      ? ' of ' + sales(total) + (shown === 1 ? ' matches.' : ' match.')
      : (total === 1 ? ' sale' : ' sales') + ' across ' + cityCount + (cityCount === 1 ? ' city.' : ' cities.')));
  }

  var favOnly = document.getElementById('fav-only');
  var favCount = document.getElementById('fav-count');
  function favorites() {
    if (window.DigFavorites) return window.DigFavorites.list();
    try {
      var parsed = JSON.parse(window.localStorage.getItem('dig-favorites') || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }
  function favsOn() {
    return favOnly && favOnly.getAttribute('aria-pressed') === 'true';
  }
  function paintFavCount() {
    if (favCount) favCount.textContent = String(favorites().length);
  }

  function remember(query, categories) {
    if (!window.history || !window.history.replaceState) return;
    var parts = [];
    if (query.trim()) parts.push('q=' + encodeURIComponent(query.trim()).replace(/%20/g, '+'));
    if (categories.length) parts.push('cat=' + categories.join(','));
    if (favsOn()) parts.push('fav=1');
    var address = window.location.pathname + (parts.length ? '?' + parts.join('&') : '');
    if (address !== window.location.pathname + window.location.search) window.history.replaceState(null, '', address);
  }

  function show() {
    paintFavCount();
    if (!prepared) return;
    var query = input.value;
    var categories = chosen();
    var filtering = fold(query) !== '' || categories.length > 0 || favsOn();
    var keep = {};
    var found = find(prepared, query, categories, favsOn() ? favorites() : null);
    found.forEach(function (sale) { keep[sale.id] = true; });
    var shown = 0;
    hits.forEach(function (hit) {
      var match = keep[hit.getAttribute('data-id')] === true;
      hit.hidden = !match;
      if (match) shown += 1;
    });
    groups.forEach(function (group) {
      var all = Number(group.getAttribute('data-total'));
      var visible = group.querySelectorAll('.hit:not([hidden])').length;
      group.hidden = visible === 0;
      var counter = group.querySelector('.group-count');
      if (counter) counter.textContent = filtering && visible !== all ? visible + ' of ' + sales(all) : sales(all);
    });
    setCount(shown, filtering);
    nothing.hidden = shown !== 0;
    clear.hidden = !filtering;
    remember(query, categories);
  }

  // A link can carry a search: /search/?q=tools&cat=furniture,art
  var asked = new URLSearchParams(window.location.search);
  if (asked.get('q')) input.value = asked.get('q');
  var askedCategories = (asked.get('cat') || '').split(',');
  chips.forEach(function (chip) {
    if (!chip.disabled && askedCategories.indexOf(chip.getAttribute('data-cat')) !== -1) chip.setAttribute('aria-pressed', 'true');
    chip.addEventListener('click', function () {
      chip.setAttribute('aria-pressed', chip.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
      show();
    });
  });
  if (favOnly) {
    if (asked.get('fav') === '1') favOnly.setAttribute('aria-pressed', 'true');
    favOnly.addEventListener('click', function () {
      favOnly.setAttribute('aria-pressed', favsOn() ? 'false' : 'true');
      show();
    });
  }
  window.addEventListener('dig:favorites', show);
  paintFavCount();
  input.addEventListener('input', show);
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    show();
  });
  clear.addEventListener('click', function () {
    input.value = '';
    chips.forEach(function (chip) { chip.setAttribute('aria-pressed', 'false'); });
    if (favOnly) favOnly.setAttribute('aria-pressed', 'false');
    show();
    input.focus();
  });

  fetch(results.getAttribute('data-source'))
    .then(function (response) {
      if (!response.ok) throw Error('HTTP ' + response.status);
      return response.json();
    })
    .then(function (data) {
      prepared = prepare(data);
      show();
    })
    .catch(function () {
      status.hidden = false;
    });
})(typeof window === 'undefined' ? this : window);
