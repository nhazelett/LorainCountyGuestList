/**
 * Lorain County Bookings - Frontend App
 * Reads from data/bookings.json and renders the grid + detail views.
 */

const DATA_URL = 'data/bookings.json';

let allBookings = [];
let currentFilter = 'all';

// ── Utilities ──────────────────────────────────────────────────────

function getInitials(name) {
  if (!name) return '?';
  const parts = name.split(',');
  const last = (parts[0] || '').trim().charAt(0);
  const first = (parts[1] || '').trim().charAt(0);
  return (last + first).toUpperCase() || '?';
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    // Handle "3/30/2026 1:58 PM" format
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    });
  } catch {
    return dateStr;
  }
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d)) return '';
    return d.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true
    });
  } catch {
    return '';
  }
}

function formatRelativeDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const bookDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.floor((today - bookDate) / 86400000);

    if (diffDays === 0) return 'Today, ' + formatTime(dateStr);
    if (diffDays === 1) return 'Yesterday, ' + formatTime(dateStr);
    if (diffDays < 7) return `${diffDays} days ago`;
    return formatDate(dateStr);
  } catch {
    return dateStr;
  }
}

function classifyCharge(charge) {
  if (!charge || !charge.description) return 'other';
  const desc = charge.description.toLowerCase();
  const crimeClass = (charge.crime_class || '').toLowerCase();

  if (crimeClass.includes('felony') || crimeClass.startsWith('f')) return 'felony';
  if (crimeClass.includes('misdemeanor') || crimeClass.startsWith('m')) return 'misdemeanor';

  // Heuristic based on charge description
  const felonyKeywords = ['aggravated', 'felonious', 'trafficking', 'robbery', 'burglary', 'kidnapping', 'murder', 'manslaughter', 'arson'];
  const trafficKeywords = ['ovi', 'dui', 'driving under', 'suspended', 'plates', 'insurance', 'reckless op', 'traffic'];

  if (felonyKeywords.some(k => desc.includes(k))) return 'felony';
  if (trafficKeywords.some(k => desc.includes(k))) return 'traffic';
  if (desc.includes('misdemeanor')) return 'misdemeanor';

  return 'other';
}

function getHighestSeverity(charges) {
  if (!charges || charges.length === 0) return 'other';
  const order = ['felony', 'misdemeanor', 'traffic', 'other'];
  let highest = 'other';
  for (const c of charges) {
    const type = classifyCharge(c);
    if (order.indexOf(type) < order.indexOf(highest)) {
      highest = type;
    }
  }
  return highest;
}

function isToday(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return d.getDate() === now.getDate() &&
         d.getMonth() === now.getMonth() &&
         d.getFullYear() === now.getFullYear();
}

function isYesterday(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return d.getDate() === yesterday.getDate() &&
         d.getMonth() === yesterday.getMonth() &&
         d.getFullYear() === yesterday.getFullYear();
}

function isThisWeek(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  return d >= weekAgo && d <= now;
}

const cardColors = [
  '#1e293b', '#1a2332', '#231e2e', '#1e2e23', '#2e231e',
  '#1e232e', '#2e1e23', '#232e1e', '#1e2e2e', '#2e2e1e',
  '#231e23', '#1e2323',
];

// ── Data Loading ───────────────────────────────────────────────────

async function loadBookings() {
  try {
    const resp = await fetch(DATA_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    allBookings = data.bookings || [];
    updateStats(data);
    renderGrid();
  } catch (err) {
    console.error('Failed to load bookings:', err);
    document.getElementById('bookingGrid').innerHTML =
      '<div class="loading">Unable to load bookings. Data file may not exist yet.</div>';
  }
}

// ── Stats ──────────────────────────────────────────────────────────

function updateStats(data) {
  const todayCount = allBookings.filter(b => isToday(b.booking_date)).length;
  const weekCount = allBookings.filter(b => isThisWeek(b.booking_date)).length;

  document.getElementById('statToday').textContent = todayCount;
  document.getElementById('statWeek').textContent = weekCount;
  document.getElementById('statTotal').textContent = (data.total || allBookings.length).toLocaleString();

  if (data.last_updated) {
    const updated = new Date(data.last_updated);
    document.getElementById('statUpdated').textContent = updated.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true
    });
  }
}

// ── Grid Rendering ─────────────────────────────────────────────────

function renderGrid(searchTerm = '') {
  const grid = document.getElementById('bookingGrid');
  if (!grid) return;

  let filtered = [...allBookings];

  // Apply date filter
  if (currentFilter === 'today') {
    filtered = filtered.filter(b => isToday(b.booking_date));
  } else if (currentFilter === 'yesterday') {
    filtered = filtered.filter(b => isYesterday(b.booking_date));
  } else if (currentFilter === 'week') {
    filtered = filtered.filter(b => isThisWeek(b.booking_date));
  } else if (currentFilter === 'custody') {
    filtered = filtered.filter(b => b.in_custody === 'Yes');
  }

  // Apply search
  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    filtered = filtered.filter(b =>
      (b.name || '').toLowerCase().includes(term) ||
      (b.charges || []).some(c => (c.description || '').toLowerCase().includes(term))
    );
  }

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="no-results">No bookings found matching your criteria.</div>';
    return;
  }

  grid.innerHTML = filtered.map((b, i) => {
    const severity = getHighestSeverity(b.charges);
    const severityLabel = severity.charAt(0).toUpperCase() + severity.slice(1);
    const chargeText = (b.charges || []).map(c => c.description).join(', ') || 'No charges listed';
    const initials = getInitials(b.name);
    const bgColor = cardColors[i % cardColors.length];
    const hasMugshot = b.mugshots && b.mugshots.length > 0;

    const imgHtml = hasMugshot
      ? `<div class="card-img"><img src="${b.mugshots[0]}" alt="${b.name}" loading="lazy"></div>`
      : `<div class="card-img"><span class="card-placeholder" style="background:${bgColor};width:100%;height:100%;display:flex;align-items:center;justify-content:center;">${initials}</span></div>`;

    const custodyTag = b.in_custody === 'Yes' ? '<span class="tag tag-custody">In Custody</span>' : '';

    return `
      <a class="booking-card" href="detail.html?id=${b.booking_id}">
        ${imgHtml}
        <div class="card-body">
          <div class="card-name">${b.name || 'Unknown'}</div>
          <div class="card-meta">
            <span class="tag tag-${severity}">${severityLabel}</span>
            ${custodyTag}
          </div>
          <div class="card-charges">${chargeText}</div>
        </div>
        <div class="card-footer">
          <div class="card-date">${formatRelativeDate(b.booking_date)}</div>
          <div class="card-agency">${b.booking_origin || b.housing_facility || ''}</div>
        </div>
      </a>`;
  }).join('');
}

// ── Detail Page ────────────────────────────────────────────────────

async function loadDetail(bookingId) {
  try {
    const resp = await fetch(DATA_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const booking = (data.bookings || []).find(b => b.booking_id === bookingId);

    if (!booking) {
      document.getElementById('detailName').textContent = 'Booking not found';
      return;
    }

    // Update page title
    document.title = `${booking.name} - Lorain County Bookings`;

    // Name & meta
    document.getElementById('detailName').textContent = booking.name || 'Unknown';
    const metaParts = [];
    if (booking.booking_date) metaParts.push(`Booked ${formatDate(booking.booking_date)} at ${formatTime(booking.booking_date)}`);
    if (booking.booking_origin) metaParts.push(booking.booking_origin);
    document.getElementById('detailMeta').textContent = metaParts.join(' \u00B7 ');

    // Photo
    const photoContainer = document.getElementById('detailPhoto');
    if (booking.mugshots && booking.mugshots.length > 0) {
      photoContainer.innerHTML = `<img src="${booking.mugshots[0]}" alt="${booking.name}">`;
    }

    // Info grid
    const fields = [
      { label: 'Date of Birth', value: booking.dob },
      { label: 'Age', value: booking.age },
      { label: 'Height', value: booking.height },
      { label: 'Weight', value: booking.weight },
      { label: 'Gender', value: booking.gender },
      { label: 'Race', value: booking.race },
      { label: 'In Custody', value: booking.in_custody || 'Unknown' },
      { label: 'Facility', value: booking.housing_facility },
      { label: 'Total Bond', value: booking.total_bond },
      { label: 'Total Bail', value: booking.total_bail },
      { label: 'Prisoner Type', value: booking.prisoner_type },
      { label: 'Classification', value: booking.classification },
    ].filter(f => f.value && f.value.trim());

    document.getElementById('detailGrid').innerHTML = fields.map(f => `
      <div class="info-item">
        <div class="info-label">${f.label}</div>
        <div class="info-value">${f.value}</div>
      </div>`).join('');

    // Charges
    const chargesList = document.getElementById('chargesList');
    if (booking.charges && booking.charges.length > 0) {
      chargesList.innerHTML = booking.charges.map(c => {
        const type = classifyCharge(c);
        const metaParts = [];
        if (type !== 'other') metaParts.push(type.charAt(0).toUpperCase() + type.slice(1));
        if (c.crime_class) metaParts.push(c.crime_class);
        if (c.docket_number) metaParts.push(c.docket_number);
        if (c.offense_date) metaParts.push(`Offense: ${c.offense_date}`);

        return `
          <div class="charge-item">
            <div class="charge-severity severity-${type}"></div>
            <div class="charge-text">
              <strong>${c.description || 'Unknown Charge'}</strong>
              <span class="charge-meta">${metaParts.join(' \u00B7 ')}</span>
            </div>
          </div>`;
      }).join('');
    } else {
      chargesList.innerHTML = '<div style="color:var(--text-muted);font-size:.875rem;">No charges listed</div>';
    }

    // Bonds
    if (booking.bonds && booking.bonds.length > 0) {
      document.getElementById('bondsSection').style.display = 'block';
      document.getElementById('bondsList').innerHTML = booking.bonds.map(b => `
        <div class="bond-item">
          <div>
            <div>${b.bond_number}</div>
            <div class="bond-type">${b.bond_type}</div>
          </div>
          <div class="bond-amount">${b.bond_amount}</div>
        </div>`).join('');
    }

  } catch (err) {
    console.error('Failed to load detail:', err);
    document.getElementById('detailName').textContent = 'Error loading booking';
  }
}

// ── Event Listeners ────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Only load grid on index page
  if (document.getElementById('bookingGrid')) {
    loadBookings();
  }

  // Search
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    let debounce;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => renderGrid(searchInput.value), 200);
    });
    // Handle enter to search on both pages
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && window.location.pathname.includes('detail')) {
        window.location.href = `/?search=${encodeURIComponent(searchInput.value)}`;
      }
    });
  }

  // Filters
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderGrid(document.getElementById('searchInput')?.value || '');
    });
  });
});
