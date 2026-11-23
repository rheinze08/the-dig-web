// Draw the embedded feed data. Switching cities replaces only the marker layer.
(function () {
  var holder = document.getElementById('map');
  var source = document.getElementById('map-data');
  if (!holder || !source) return;
  var data = JSON.parse(source.textContent);
  var chooser = document.getElementById('map-city');
  var list = document.getElementById('sale-list');
  var map, markers;
  if (window.L) {
    map = L.map(holder, {scrollWheelZoom: false});
    markers = L.layerGroup().addTo(map);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    map.on('click', function () { map.scrollWheelZoom.enable(); });
    holder.addEventListener('mouseleave', function () { map.scrollWheelZoom.disable(); });
  } else {
    holder.hidden = true;
    var status = document.getElementById('map-status');
    if (status) status.hidden = false;
  }

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
    box.append(when, link, where);
    if (pin.rating) {
      var rating = document.createElement('strong');
      rating.textContent = pin.rating;
      box.appendChild(rating);
    }
    return box;
  }

  function connectCard(marker, card) {
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
  }

  function addPin(pin, single, dx, dy) {
    var point = [pin.lat, pin.lng];
    var icon = L.divIcon({
      className: 'dig-pin' + (pin.approx ? ' approximate' : '') + (pin.ended ? ' ended' : ''),
      html: '<div class="pin-face"><span>' + (single || chooser ? '' : Number(pin.n)) + '</span></div>',
      iconSize: [28, 28],
      iconAnchor: [14 - dx, (pin.approx ? 14 : 34) - dy],
      popupAnchor: [dx, (pin.approx ? -14 : -32) + dy]
    });
    var marker = L.marker(point, {icon: icon, title: pin.title, alt: pin.title}).addTo(markers);
    if (pin.rating) marker.getElement().dataset.rating = pin.rating;
    if (single) {
      if (pin.approx) {
        L.circle(point, {radius: 1300, color: '#944021', weight: 2, dashArray: '6 6', fillColor: '#edb786', fillOpacity: 0.18}).addTo(markers);
      }
      return;
    }
    // Keep popup text below the zoom buttons, including on narrow screens.
    marker.bindPopup(function () { return popup(pin); }, {autoPanPaddingTopLeft: [8, 82]});
    var card = document.getElementById('sale-' + pin.id);
    if (card) connectCard(marker, card);
  }

  function draw(city) {
    if (!map) return;
    map.closePopup();
    markers.clearLayers();
    var pins = city.pins;
    holder.hidden = !pins.length && !city.center;
    if (holder.hidden) return;
    map.invalidateSize();
    var points = pins.map(function (pin) { return [pin.lat, pin.lng]; });
    var single = city.single === true && pins.length === 1;
    if (single) {
      map.setView(points[0], pins[0].approx ? 13 : 15);
    } else if (points.length) {
      map.fitBounds(points, {padding: [42, 42], maxZoom: 14, animate: false});
    } else {
      map.setView(city.center, 10, {animate: false});
    }

    // Offset coincident icons in screen pixels. Their geographic points stay exact.
    var groups = new Map();
    pins.forEach(function (pin) {
      var key = pin.lat.toFixed(5) + ',' + pin.lng.toFixed(5);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(pin);
    });
    groups.forEach(function (group) {
      var radius = group.length > 1 ? 16 / Math.sin(Math.PI / group.length) : 0;
      group.forEach(function (pin, index) {
        var angle = 2 * Math.PI * index / group.length;
        addPin(pin, single, Math.round(radius * Math.cos(angle)), Math.round(radius * Math.sin(angle)));
      });
    });
  }

  if (!chooser) {
    draw(data);
    return;
  }

  var bySlug = new Map(data.cities.map(function (city) { return [city.slug, city]; }));
  var count = document.getElementById('map-count');
  var listLink = document.getElementById('map-city-list');
  function selectCity(slug) {
    var city = bySlug.get(slug) || bySlug.get(data.defaultCity);
    chooser.value = city.slug;
    var mapped = city.pins.length;
    if (city.total === null) {
      count.textContent = city.name + ' sales feed is unavailable.';
    } else {
      count.textContent = (mapped === city.total ? mapped : mapped + ' of ' + city.total) +
        (city.total === 1 ? ' sale' : ' sales') + ' mapped in ' + city.name;
    }
    listLink.hidden = !city.url;
    if (city.url) {
      listLink.href = city.url;
      listLink.textContent = 'View the ' + city.name + ' sale list';
    }
    holder.setAttribute('aria-label', 'Map of ' + city.name + ' estate sales');
    draw(city);
  }
  selectCity(new URL(location.href).searchParams.get('city'));
  chooser.addEventListener('change', function () {
    selectCity(chooser.value);
    var url = new URL(location.href);
    url.searchParams.set('city', chooser.value);
    history.replaceState(null, '', url);
  });
})();
