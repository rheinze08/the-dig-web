// The site is rebuilt once a day. If a visitor's day in the city's time zone is
// later than the day the page was built for, correct the labels that depend on it.
(function () {
  var zone = document.body.getAttribute('data-time-zone');
  var built = document.body.getAttribute('data-built-for');
  if (!zone || !built) return;
  var today;
  try {
    var parts = new Intl.DateTimeFormat('en-US', {timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date());
    var pick = function (type) { return parts.filter(function (part) { return part.type === type; })[0].value; };
    today = pick('year') + '-' + pick('month') + '-' + pick('day');
  } catch (error) {
    return;
  }
  if (today <= built) return;

  // "Open today" was true on the build day only.
  Array.prototype.forEach.call(document.querySelectorAll('.tag-open[data-day]'), function (tag) {
    if (tag.getAttribute('data-day') !== today) tag.remove();
  });
  Array.prototype.forEach.call(document.querySelectorAll('.sessions tr[data-day]'), function (row) {
    var day = row.getAttribute('data-day');
    row.classList.toggle('is-today', day === today);
    row.classList.toggle('past', day < today);
  });
  // Sales whose last day has passed since the build.
  Array.prototype.forEach.call(document.querySelectorAll('.sale[data-last]'), function (card) {
    if (card.getAttribute('data-last') >= today || card.classList.contains('is-ended')) return;
    card.classList.add('is-ended');
    var dates = card.querySelector('.dates');
    if (!dates) return;
    var tag = document.createElement('span');
    tag.className = 'tag tag-ended';
    tag.textContent = 'Ended';
    dates.appendChild(document.createTextNode(' '));
    dates.appendChild(tag);
  });
  var fresh = document.querySelector('.fresh');
  if (fresh) {
    var note = document.createElement('p');
    note.className = 'stale';
    note.textContent = 'This page was built before today. Labels have been adjusted for today, and the next daily rebuild will catch it up.';
    fresh.insertAdjacentElement('afterend', note);
  }
})();
