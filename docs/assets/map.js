// Draws the sale pins from the JSON the build wrote into the page.
(function () {
  var holder = document.getElementById('map');
  var source = document.getElementById('map-data');
  if (!holder || !source) return;
  var status = document.getElementById('map-status');
  if (!window.L) {
    holder.hidden = true;
    if (status) status.hidden = false;
    return;
  }
  var data = JSON.parse(source.textContent);
  var pins = data.pins || [];
  // A sale page shows one unnumbered pin. List pages number their pins.
  var single = data.single === true && pins.length === 1;
  var map = L.map(holder, {scrollWheelZoom: false});
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  // The page scrolls past the map until someone clicks into it.
  map.on('click', function () { map.scrollWheelZoom.enable(); });
  holder.addEventListener('mouseleave', function () { map.scrollWheelZoom.disable(); });

  // Sales that share one approximate point are fanned out so each pin can be clicked.
  var groups = {};
  pins.forEach(function (pin) {
    var key = pin.lat.toFixed(5) + ',' + pin.lng.toFixed(5);
    (groups[key] = groups[key] || []).push(pin);
  });
  Object.keys(groups).forEach(function (key) {
    var group = groups[key];
    if (group.length < 2) return;
    group.forEach(function (pin, index) {
      var angle = 2 * Math.PI * index / group.length;
      pin.lat += 0.0016 * Math.cos(angle);
      pin.lng += 0.0019 * Math.sin(angle);
    });
  });

  function popup(pin) {
    var box = document.createElement('div');
    box.className = 'pin-popup';
    var when = document.createElement('b');
    when.textContent = pin.when;
    var link = document.createElement('a');
    link.href = pin.url;
    link.textContent = pin.title;
    var where = document.createElement('span');
    where.textContent = pin.where + (pin.approx ? ' (approximate area)' : '');
    box.appendChild(when);
    box.appendChild(link);
    box.appendChild(where);
    return box;
  }

  var list = document.getElementById('sale-list');
  var points = [];
  pins.forEach(function (pin) {
    var point = [pin.lat, pin.lng];
    points.push(point);
    var icon = L.divIcon({
      className: 'dig-pin' + (pin.approx ? ' approximate' : '') + (pin.ended ? ' ended' : ''),
      html: '<div class="pin-face"><span>' + (single ? '' : Number(pin.n)) + '</span></div>',
      iconSize: [28, 28],
      iconAnchor: pin.approx ? [14, 14] : [14, 34],
      popupAnchor: pin.approx ? [0, -14] : [0, -32]
    });
    var marker = L.marker(point, {icon: icon, title: pin.title, alt: single ? pin.title : 'Sale ' + pin.n + ': ' + pin.title});
    marker.addTo(map);
    var card = document.getElementById('sale-' + pin.id);
    if (single) {
      if (pin.approx) {
        L.circle(point, {radius: 1300, color: '#944021', weight: 2, dashArray: '6 6', fillColor: '#edb786', fillOpacity: 0.18}).addTo(map);
      }
      return;
    }
    marker.bindPopup(function () { return popup(pin); });
    if (!card) return;
    marker.on('popupopen', function () {
      card.classList.add('selected');
      if (list && getComputedStyle(list).overflowY === 'auto') card.scrollIntoView({block: 'nearest'});
    });
    marker.on('popupclose', function () { card.classList.remove('selected'); });
    function lift(on) {
      var element = marker.getElement();
      if (element) element.classList.toggle('active-pin', on);
      marker.setZIndexOffset(on ? 1000 : 0);
    }
    card.addEventListener('mouseenter', function () { lift(true); });
    card.addEventListener('mouseleave', function () { lift(false); });
    card.addEventListener('focusin', function () { lift(true); });
    card.addEventListener('focusout', function () { lift(false); });
  });

  if (single) {
    map.setView(points[0], pins[0].approx ? 13 : 15);
  } else if (points.length) {
    map.fitBounds(points, {padding: [30, 30], maxZoom: 14});
  } else if (data.center) {
    map.setView(data.center, 10);
  } else {
    holder.hidden = true;
  }
})();
