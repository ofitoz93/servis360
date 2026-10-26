// Servis360 Pro - OSRM Gerçek Yol Motoru, Personel & Öğrenci/Veli Yönetimi

// Harita Değişkenleri
let liveMap = null;
let liveMapShuttleMarker = null;
let liveMapGeofenceCircle = null;
let liveMapPolyline = null;
let liveMapStopMarkers = [];

let workplaceMap = null;
let workplaceMarker = null;
let workplaceCircle = null;

let routeBuilderMap = null;
let routeBuilderStops = [];
let routeBuilderMarkers = [];
let routeBuilderPolyline = null;
let calculatedRoadGeometry = [];
let calculatedDistanceKm = 0;
let calculatedDurationMins = 0;

let state = {
  currentUser: null,
  activeCompanyId: null,
  activeCompanyData: null,
  companies: [],
  simulationStep: 0,
  isLive: false
};

// 100% ÜCRETSİZ OPENSTREETMAP HARİTA KATMANI
function createOsmTileLayer() {
  return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  });
}

// =========================================================================
// OSRM GERÇEK YOL MOTORU (Yollar Üzerinden Düzgün Rota Planlama)
// =========================================================================
async function fetchOsrmRoadRoute(coords) {
  // coords: [[lat, lng], [lat, lng], ...]
  if (!coords || coords.length < 2) return null;

  // OSRM URL formatı: lng1,lat1;lng2,lat2;...
  const coordsParam = coords.map(([lat, lng]) => `${lng},${lat}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coordsParam}?overview=full&geometries=geojson`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
      const route = data.routes[0];
      // GeoJSON koordinatları [lng, lat] gelir, Leaflet için [lat, lng]'e çevir
      const roadCoords = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      return {
        coordinates: roadCoords,
        distanceKm: (route.distance / 1000).toFixed(1),
        durationMins: Math.round(route.duration / 60)
      };
    }
  } catch (err) {
    console.warn('OSRM yol motoru geçici olarak yanıt vermedi, düz çizgiye dönülüyor:', err);
  }

  // Fallback: OSRM yanıt vermezse doğrudan noktaları bağla
  return {
    coordinates: coords,
    distanceKm: 0,
    durationMins: 0
  };
}

document.addEventListener('DOMContentLoaded', () => {
  showLoginScreen();
});

// =========================================================================
// 1. GİRİŞ VE OTURUM YÖNETİMİ
// =========================================================================
function showLoginScreen() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('dashboardScreen').classList.remove('active');
  state.currentUser = null;
}

function showDashboardScreen() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('dashboardScreen').classList.add('active');
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('inputEmail').value.trim();
  const password = document.getElementById('inputPassword').value.trim();
  const submitBtn = document.getElementById('btnLoginSubmit');

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span>Giriş yapılıyor...</span>';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Giriş yapılamadı.');

    state.currentUser = data.user;
    setupUserDashboard(data.user);
    showToast("Hoş Geldiniz", `${data.user.full_name} olarak giriş yapıldı.`, "success");
  } catch (err) {
    showToast("Giriş Başarısız", err.message, "danger");
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span>Giriş Yap</span><span>➔</span>';
  }
}

function handleLogout() {
  showLoginScreen();
  document.getElementById('inputPassword').value = '';
  showToast("Oturum Kapatıldı", "Güvenli çıkış yapıldı.", "info");
}

// =========================================================================
// 2. DASHBOARD VE DİNAMİK ARAYÜZ (PERSONEL vs ÖĞRENCİ SERVİSİ)
// =========================================================================
function setupUserDashboard(user) {
  showDashboardScreen();

  document.getElementById('sidebarUserName').innerText = user.full_name || user.email;
  document.getElementById('sidebarUserRole').innerText = user.role === 'superadmin' ? 'Süper Admin' : (user.company_name || 'Yönetici');
  document.getElementById('sidebarAvatar').innerText = user.role === 'superadmin' ? 'SA' : (user.operation_type === 'school' ? '🎓' : '🏢');

  const superAdminSec = document.getElementById('sidebarSuperAdminSection');
  const companySec = document.getElementById('sidebarCompanySection');
  const topbarBadge = document.getElementById('topbarCompanyBadge');

  if (user.role === 'superadmin') {
    superAdminSec.style.display = 'block';
    companySec.style.display = 'none';
    topbarBadge.style.display = 'none';

    navigateTo('adminCustomers');
    loadSuperAdminCompanies();
  } else {
    superAdminSec.style.display = 'none';
    companySec.style.display = 'block';
    topbarBadge.style.display = 'inline-flex';
    topbarBadge.innerText = user.company_name || 'Kurum';

    state.activeCompanyId = user.company_id;

    // Şartlı Entegrasyon Menüsü
    const btnIntegration = document.getElementById('btnNavCompanyIntegration');
    if (user.service_type === 'integration') {
      btnIntegration.style.display = 'flex';
    } else {
      btnIntegration.style.display = 'none';
    }

    navigateTo('companyWorkplace');
    loadCompanyData(user.company_id);
  }
}

// Müşterinin Faaliyet Türüne Göre Arayüz Metinlerini Güncelle (Personel vs Okul)
function adaptUiForOperationType(operationType) {
  const isSchool = operationType === 'school';
  const opTag = document.getElementById('topbarOperationTag');
  opTag.innerText = isSchool ? '🎓 Öğrenci Modu' : '🏢 Personel Modu';

  document.getElementById('sidebarOperationBadge').innerText = isSchool ? 'Öğrenci Servisi' : 'Personel Servisi';

  // 1. Sol Menü Etiketleri
  if (isSchool) {
    document.getElementById('navIconWorkplace').innerText = '🏫';
    document.getElementById('navTextWorkplace').innerText = 'Okul / Kampüs Lokasyonu';
    document.getElementById('navIconPassengers').innerText = '🎓';
    document.getElementById('navTextPassengers').innerText = 'Öğrenci & Veli Yönetimi';

    // Sayfa Başlıkları
    document.getElementById('titleWorkplaceCard').innerText = 'Hedef Okul / Kampüs Lokasyonu Belirleme';
    document.getElementById('descWorkplaceCard').innerText = 'Okulunuzun yerini haritada tıklayarak belirleyin. Servis okul kapısına vardığında canlı konum otomatik durdurulur.';
    document.getElementById('labelWorkplaceName').innerText = 'Okul / Kampüs Adı';

    document.getElementById('titlePassengerPage').innerText = 'Öğrenci & Veli Yönetimi';
    document.getElementById('descPassengerPage').innerText = 'Öğrencileri kaydedin, veli iletişim numaralarını tanımlayın ve servise atayın.';
    document.getElementById('btnTextAddPassenger').innerText = '➕ Yeni Öğrenci Ekle';
    document.getElementById('titlePassengerTable').innerText = 'Kayıtlı Öğrenciler ve Veli Bilgileri';

    // Modal
    document.getElementById('modalTitleAddPassenger').innerText = '🎓 Yeni Öğrenci & Veli Tanımla';
    document.getElementById('labelPassengerFullName').innerText = 'Öğrenci Adı Soyadı';
    document.getElementById('formSectionPersonnel').style.display = 'none';
    document.getElementById('formSectionStudent').style.display = 'block';

    // Tablo Kolonları
    document.getElementById('theadPassengerCols').innerHTML = `
      <th>Öğrenci Adı</th>
      <th>Sınıf / No</th>
      <th>Veli Adı & Yakınlık</th>
      <th>Veli Telefonu (SMS)</th>
      <th>Servis (Plaka)</th>
      <th>Biniş Durağı</th>
      <th>Servis Durumu</th>
    `;
  } else {
    document.getElementById('navIconWorkplace').innerText = '📍';
    document.getElementById('navTextWorkplace').innerText = 'Fabrika / Lokasyon Ayarları';
    document.getElementById('navIconPassengers').innerText = '👥';
    document.getElementById('navTextPassengers').innerText = 'Personel Yönetimi';

    document.getElementById('titleWorkplaceCard').innerText = 'Hedef Fabrika / Tesis Lokasyonu Belirleme';
    document.getElementById('descWorkplaceCard').innerText = 'Fabrika / şirketinizin yerini haritada tıklayarak işaretleyin. Servis bu çite girdiğinde canlı konum otomatik durdurulur.';
    document.getElementById('labelWorkplaceName').innerText = 'Fabrika / Tesis Adı';

    document.getElementById('titlePassengerPage').innerText = 'Personel Yönetimi';
    document.getElementById('descPassengerPage').innerText = 'Çalışanlarınızı ekleyin, servislere ve biniş duraklarına atayın.';
    document.getElementById('btnTextAddPassenger').innerText = '➕ Yeni Personel Ekle';
    document.getElementById('titlePassengerTable').innerText = 'Kayıtlı Personel Listesi';

    // Modal
    document.getElementById('modalTitleAddPassenger').innerText = '👤 Yeni Personel Ekle';
    document.getElementById('labelPassengerFullName').innerText = 'Personel Adı Soyadı';
    document.getElementById('formSectionPersonnel').style.display = 'block';
    document.getElementById('formSectionStudent').style.display = 'none';

    // Tablo Kolonları
    document.getElementById('theadPassengerCols').innerHTML = `
      <th>Personel Adı</th>
      <th>Departman</th>
      <th>Telefon</th>
      <th>Atanan Servis</th>
      <th>Biniş Durağı</th>
      <th>Durum</th>
    `;
  }
}

// =========================================================================
// 3. SOL MENÜ GEÇİŞLERİ VE SAYFA YÖNETİMİ
// =========================================================================
function navigateTo(viewName) {
  document.querySelectorAll('.sidebar-item').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));

  const headingEl = document.getElementById('pageMainHeading');
  const subHeadingEl = document.getElementById('pageSubHeading');
  const isSchool = state.activeCompanyData && state.activeCompanyData.company.operation_type === 'school';

  if (viewName === 'adminCustomers') {
    document.getElementById('btnNavAdminCustomers').classList.add('active');
    document.getElementById('viewAdminCustomers').classList.add('active');
    headingEl.innerText = 'Müşteri Yönetimi';
    subHeadingEl.innerText = 'Personel ve Öğrenci servisi hizmeti alan müşteri hesapları';
  } else if (viewName === 'adminSync') {
    document.getElementById('btnNavAdminSync').classList.add('active');
    document.getElementById('viewAdminSync').classList.add('active');
    headingEl.innerText = '1. İK & ERP Personel / Öğrenci Senkronizasyonu';
    subHeadingEl.innerText = 'Dış sistemler ile otomatik çalışan/öğrenci senkronizasyon altyapısı';
  } else if (viewName === 'companyWorkplace') {
    document.getElementById('btnNavCompanyWorkplace').classList.add('active');
    document.getElementById('viewCompanyWorkplace').classList.add('active');
    headingEl.innerText = isSchool ? 'Okul / Kampüs Lokasyonu' : 'Fabrika / Lokasyon Ayarları';
    subHeadingEl.innerText = 'Harita üzerinden hedefi seçin ve sanal çiti belirleyin';

    setTimeout(() => { initWorkplacePickerMap(); }, 200);
  } else if (viewName === 'companyShuttles') {
    document.getElementById('btnNavCompanyShuttles').classList.add('active');
    document.getElementById('viewCompanyShuttles').classList.add('active');
    headingEl.innerText = 'Servis Araçları Yönetimi';
    subHeadingEl.innerText = 'Filo araçları, koltuk kapasiteleri ve şoför atamaları';
  } else if (viewName === 'companyRoutes') {
    document.getElementById('btnNavCompanyRoutes').classList.add('active');
    document.getElementById('viewCompanyRoutes').classList.add('active');
    headingEl.innerText = 'Yollar Üzerinden Rota & Durak Planlama';
    subHeadingEl.innerText = 'Durakları haritadan seçin, sistem gerçek yollardan rotayı çıkarsın';

    setTimeout(() => { initRouteBuilderMap(); }, 200);
  } else if (viewName === 'companyEmployees') {
    document.getElementById('btnNavCompanyEmployees').classList.add('active');
    document.getElementById('viewCompanyEmployees').classList.add('active');
    headingEl.innerText = isSchool ? 'Öğrenci & Veli Yönetimi' : 'Personel Yönetimi';
    subHeadingEl.innerText = isSchool ? 'Öğrenci listesi, veli telefonları ve servis atamaları' : 'Çalışan listesi, servis ve durak eşleştirmeleri';
  } else if (viewName === 'companyLiveMap') {
    document.getElementById('btnNavCompanyLiveMap').classList.add('active');
    document.getElementById('viewCompanyLiveMap').classList.add('active');
    headingEl.innerText = 'Canlı Servis Takip';
    subHeadingEl.innerText = 'Yollar üzerinde anlık canlı GPS akışı ve geofence otomasyonu';

    setupLiveMapOrEmptyState();
  } else if (viewName === 'companyIntegration') {
    document.getElementById('btnNavCompanyIntegration').classList.add('active');
    document.getElementById('viewCompanyIntegration').classList.add('active');
    headingEl.innerText = 'Kurumsal Entegrasyon Portalı';
    subHeadingEl.innerText = 'Özel API token ve Webhook bildirimleri';
  }
}

// =========================================================================
// 4. FABRİKA / OKUL LOKASYONUNU HARİTADAN SEÇME
// =========================================================================
function initWorkplacePickerMap() {
  const container = document.getElementById('workplacePickerMap');
  if (!container) return;

  const initialLat = parseFloat(document.getElementById('wpInputLat').value) || 41.1105;
  const initialLng = parseFloat(document.getElementById('wpInputLng').value) || 29.0225;
  const radius = parseInt(document.getElementById('wpInputGeofence').value) || 180;
  const isSchool = state.activeCompanyData && state.activeCompanyData.company.operation_type === 'school';

  if (!workplaceMap) {
    workplaceMap = L.map('workplacePickerMap', {
      zoomControl: true,
      attributionControl: false
    }).setView([initialLat, initialLng], 14);

    createOsmTileLayer().addTo(workplaceMap);

    const wpIcon = L.divIcon({
      className: 'custom-pin',
      html: `<div class="workplace-marker-icon">${isSchool ? '🏫' : '🏢'}</div>`,
      iconSize: [42, 42],
      iconAnchor: [21, 21]
    });

    workplaceMarker = L.marker([initialLat, initialLng], {
      icon: wpIcon,
      draggable: true
    }).addTo(workplaceMap);

    workplaceCircle = L.circle([initialLat, initialLng], {
      radius: radius,
      color: '#f43f5e',
      fillColor: '#f43f5e',
      fillOpacity: 0.18,
      dashArray: '6, 6',
      weight: 2
    }).addTo(workplaceMap);

    workplaceMap.on('click', (e) => {
      setWorkplaceLocation(e.latlng.lat, e.latlng.lng);
    });

    workplaceMarker.on('dragend', (e) => {
      const pos = e.target.getLatLng();
      setWorkplaceLocation(pos.lat, pos.lng);
    });
  } else {
    workplaceMap.invalidateSize();
    workplaceMarker.setLatLng([initialLat, initialLng]);
    workplaceCircle.setLatLng([initialLat, initialLng]);
    workplaceCircle.setRadius(radius);
    workplaceMap.setView([initialLat, initialLng], 14);
  }
}

function setWorkplaceLocation(lat, lng) {
  document.getElementById('wpInputLat').value = lat.toFixed(6);
  document.getElementById('wpInputLng').value = lng.toFixed(6);

  if (workplaceMarker) workplaceMarker.setLatLng([lat, lng]);
  if (workplaceCircle) workplaceCircle.setLatLng([lat, lng]);
  if (workplaceMap) workplaceMap.panTo([lat, lng]);

  showToast("📍 Konum Belirlendi", `Koordinatlar: ${lat.toFixed(4)}, ${lng.toFixed(4)}`, "info");
}

function updateWorkplaceGeofenceRadius(radius) {
  const r = parseInt(radius) || 180;
  if (workplaceCircle) workplaceCircle.setRadius(r);
}

function getBrowserCurrentLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setWorkplaceLocation(pos.coords.latitude, pos.coords.longitude);
        showToast("GPS Konumu Alındı", "Cihazınızın konumu hedef olarak işaretlendi.", "success");
      },
      () => {
        showToast("Uyarı", "Tarayıcı konum izni verilmedi.", "warning");
      }
    );
  }
}

async function handleSaveWorkplace(e) {
  e.preventDefault();
  const payload = {
    workplace_name: document.getElementById('wpInputName').value.trim(),
    workplace_lat: parseFloat(document.getElementById('wpInputLat').value),
    workplace_lng: parseFloat(document.getElementById('wpInputLng').value),
    geofence_radius_meters: parseInt(document.getElementById('wpInputGeofence').value)
  };

  try {
    const res = await fetch(`/api/company/${state.activeCompanyId}/workplace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Kaydedilemedi');

    await loadCompanyData(state.activeCompanyId);
    showToast("Başarılı", "Lokasyon ve sanal çit veritabanına kaydedildi.", "success");
  } catch (err) {
    showToast("Hata", err.message, "danger");
  }
}

// =========================================================================
// 5. OSRM GERÇEK YOL MOTORU İLE ROTA VE DURAK BELİRLEME (KULLANICI TALEBİ)
// =========================================================================
function initRouteBuilderMap() {
  const container = document.getElementById('routeBuilderMap');
  if (!container) return;

  const comp = state.activeCompanyData ? state.activeCompanyData.company : null;
  const targetLat = comp ? comp.workplace_lat : 41.0500;
  const targetLng = comp ? comp.workplace_lng : 29.0200;
  const isSchool = comp && comp.operation_type === 'school';

  if (!routeBuilderMap) {
    routeBuilderMap = L.map('routeBuilderMap', {
      zoomControl: true,
      attributionControl: false
    }).setView([targetLat, targetLng], 13);

    createOsmTileLayer().addTo(routeBuilderMap);

    const targetIcon = L.divIcon({
      className: 'custom-pin',
      html: `<div class="workplace-marker-icon" title="Hedef">${isSchool ? '🏫' : '🏢'}</div>`,
      iconSize: [38, 38],
      iconAnchor: [19, 19]
    });
    L.marker([targetLat, targetLng], { icon: targetIcon })
      .bindPopup(`<b>${comp ? comp.workplace_name : 'Hedef'}</b><br>Varış Noktası`)
      .addTo(routeBuilderMap);

    // Haritaya tıklandıkça yeni durak ekle ve yollardan rota çıkar!
    routeBuilderMap.on('click', async (e) => {
      await addStopToRouteBuilder(e.latlng.lat, e.latlng.lng);
    });
  } else {
    routeBuilderMap.invalidateSize();
  }
}

async function addStopToRouteBuilder(lat, lng) {
  const stopIndex = routeBuilderStops.length + 1;
  const stopName = `Durak ${stopIndex}`;

  const newStop = {
    id: 'temp_' + Date.now(),
    order: stopIndex,
    stop_name: stopName,
    lat: lat,
    lng: lng,
    eta_time: `07:${(15 + (stopIndex * 10)).toString().padStart(2, '0')}`
  };

  routeBuilderStops.push(newStop);

  const stopIcon = L.divIcon({
    className: 'custom-pin',
    html: `<div class="stop-marker-icon">${stopIndex}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13]
  });

  const marker = L.marker([lat, lng], { icon: stopIcon })
    .bindPopup(`<b>${stopName}</b><br>Saat: ${newStop.eta_time}`)
    .addTo(routeBuilderMap);

  routeBuilderMarkers.push(marker);

  // Yollar üzerinden gerçek rotayı çiz!
  await recalculateRoadRoute();
  renderRouteBuilderStopsList();

  showToast("📍 Durak Eklendi", `${stopName} rotaya eklendi. Yollar hesaplanıyor...`, "info");
}

async function recalculateRoadRoute() {
  if (routeBuilderPolyline) {
    routeBuilderMap.removeLayer(routeBuilderPolyline);
    routeBuilderPolyline = null;
  }

  const summaryBox = document.getElementById('routeCalculationSummaryBox');
  const summaryText = document.getElementById('routeCalcStats');

  if (routeBuilderStops.length === 0) {
    summaryBox.style.display = 'none';
    calculatedRoadGeometry = [];
    return;
  }

  const comp = state.activeCompanyData ? state.activeCompanyData.company : null;
  const targetCoord = comp ? [comp.workplace_lat, comp.workplace_lng] : null;

  // Sırasıyla duraklar + Varış noktası
  const waypoints = routeBuilderStops.map(s => [s.lat, s.lng]);
  if (targetCoord) waypoints.push(targetCoord);

  // OSRM Açık Kaynak Yol Motorundan Gerçek Yol Çizgisini Çek!
  const osrmResult = await fetchOsrmRoadRoute(waypoints);

  if (osrmResult && osrmResult.coordinates) {
    calculatedRoadGeometry = osrmResult.coordinates;
    calculatedDistanceKm = osrmResult.distanceKm || 0;
    calculatedDurationMins = osrmResult.durationMins || 0;

    // Gerçek cadde/otoyol virajlarını takip eden çizgiyi çiz
    routeBuilderPolyline = L.polyline(calculatedRoadGeometry, {
      color: '#3b82f6',
      weight: 5,
      opacity: 0.85
    }).addTo(routeBuilderMap);

    summaryBox.style.display = 'block';
    summaryText.innerText = `Toplam Mesafe: ${calculatedDistanceKm} km | Tahmini Yolculuk: ~${calculatedDurationMins} dakika`;
  }
}

function renderRouteBuilderStopsList() {
  const container = document.getElementById('routeBuilderStopsContainer');
  if (routeBuilderStops.length === 0) {
    container.innerHTML = `
      <div style="color: var(--text-dim); font-size: 0.775rem; text-align: center; padding: 1.5rem 0;">
        Henüz durak eklenmedi.<br>Yandaki haritaya tıklayarak durak ekleyin.
      </div>
    `;
    return;
  }

  container.innerHTML = routeBuilderStops.map((st, idx) => `
    <div class="stop-builder-chip">
      <span class="badge-num">${st.order}</span>
      <input type="text" value="${st.stop_name}" 
             style="background:transparent; border:none; color:#fff; font-size:0.825rem; font-weight:600; outline:none; flex:1;" 
             onchange="updateStopName(${idx}, this.value)">
      <span style="font-size:0.75rem; color:var(--text-muted);">${st.eta_time}</span>
      <button class="btn-remove-stop" onclick="removeStopFromBuilder(${idx})" title="Durağı Kaldır">&times;</button>
    </div>
  `).join('');
}

function updateStopName(idx, newName) {
  if (routeBuilderStops[idx]) {
    routeBuilderStops[idx].stop_name = newName;
  }
}

async function removeStopFromBuilder(idx) {
  if (routeBuilderMarkers[idx]) {
    routeBuilderMap.removeLayer(routeBuilderMarkers[idx]);
  }

  routeBuilderStops.splice(idx, 1);
  routeBuilderMarkers.splice(idx, 1);

  routeBuilderStops.forEach((s, i) => {
    s.order = i + 1;
    if (routeBuilderMarkers[i]) {
      const updatedIcon = L.divIcon({
        className: 'custom-pin',
        html: `<div class="stop-marker-icon">${i + 1}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      });
      routeBuilderMarkers[i].setIcon(updatedIcon);
    }
  });

  await recalculateRoadRoute();
  renderRouteBuilderStopsList();
}

function clearRouteBuilderStops() {
  routeBuilderMarkers.forEach(m => routeBuilderMap.removeLayer(m));
  routeBuilderMarkers = [];
  routeBuilderStops = [];
  if (routeBuilderPolyline) {
    routeBuilderMap.removeLayer(routeBuilderPolyline);
    routeBuilderPolyline = null;
  }
  calculatedRoadGeometry = [];
  document.getElementById('routeCalculationSummaryBox').style.display = 'none';
  renderRouteBuilderStopsList();
}

// Yollar Üzerinden Çizilen Rotayı Veritabanına Kaydet
async function saveRouteFromBuilder() {
  const shuttleId = parseInt(document.getElementById('routeBuilderShuttleSelect').value);
  const routeName = document.getElementById('routeBuilderNameInput').value.trim();

  if (!shuttleId) {
    showToast("Eksik Bilgi", "Lütfen önce bir servis aracı seçin.", "warning");
    return;
  }

  if (routeBuilderStops.length === 0) {
    showToast("Durak Yok", "Lütfen harita üzerine tıklayarak en az 1 durak ekleyin.", "warning");
    return;
  }

  const payload = {
    shuttle_id: shuttleId,
    route_name: routeName || 'Yol Güzergahı',
    color: '#3b82f6',
    stops: routeBuilderStops.map(s => ({
      stop_name: s.stop_name,
      lat: s.lat,
      lng: s.lng,
      eta_time: s.eta_time
    })),
    road_geometry: calculatedRoadGeometry,
    total_distance_km: calculatedDistanceKm,
    total_duration_mins: calculatedDurationMins
  };

  try {
    const res = await fetch(`/api/company/${state.activeCompanyId}/routes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Rota kaydedilemedi.');

    clearRouteBuilderStops();
    await loadCompanyData(state.activeCompanyId);
    showToast("🎉 Gerçek Yol Rotası Kaydedildi", `${payload.route_name} (${calculatedDistanceKm} km) veritabanına işlendi.`, "success");
  } catch (err) {
    showToast("Hata", err.message, "danger");
  }
}

// =========================================================================
// 6. CANLI TAKİP HARİTASI (GERÇEK YOLLARDA AKIŞ)
// =========================================================================
let autoDriveInterval = null;
let currentLiveRoadPoints = [];

function setupLiveMapOrEmptyState() {
  const data = state.activeCompanyData;
  const emptyStateBox = document.getElementById('liveMapEmptyState');
  const activeContainer = document.getElementById('liveMapActiveContainer');

  if (!data || !data.routes || data.routes.length === 0) {
    emptyStateBox.style.display = 'flex';
    activeContainer.style.display = 'none';
  } else {
    emptyStateBox.style.display = 'none';
    activeContainer.style.display = 'block';

    // Rota seçici dropdown'u doldur
    const routeSelect = document.getElementById('liveMapRouteSelect');
    if (routeSelect) {
      // Önce en son eklenen veya road_geometry olan rotayı varsayılan yap
      let defaultRoute = data.routes.find(r => r.road_geometry && Array.isArray(r.road_geometry) && r.road_geometry.length > 0) || data.routes[data.routes.length - 1];
      if (!state.activeRouteId || !data.routes.find(r => r.id === state.activeRouteId)) {
        state.activeRouteId = defaultRoute ? defaultRoute.id : data.routes[0].id;
      }

      routeSelect.innerHTML = data.routes.map(r => {
        const distStr = r.total_distance_km ? ` (${r.total_distance_km} km)` : '';
        return `<option value="${r.id}" ${r.id === state.activeRouteId ? 'selected' : ''}>${r.route_name}${distStr}</option>`;
      }).join('');
    }

    setTimeout(() => {
      initLiveMapWithCompanyRoutes(data, state.activeRouteId);
    }, 200);
  }
}

function onLiveMapRouteChange(routeId) {
  state.activeRouteId = parseInt(routeId);
  resetLiveSimulation();
  if (state.activeCompanyData) {
    initLiveMapWithCompanyRoutes(state.activeCompanyData, state.activeRouteId);
  }
}

function initLiveMapWithCompanyRoutes(data, targetRouteId) {
  const container = document.getElementById('leafletMap');
  if (!container) return;

  const comp = data.company;
  const targetCoord = [comp.workplace_lat, comp.workplace_lng];
  const isSchool = comp.operation_type === 'school';

  // Seçili rotayı bul
  let currentRoute = data.routes.find(r => r.id === targetRouteId) || data.routes[data.routes.length - 1];
  if (!currentRoute) return;

  const routeStops = data.stops.filter(s => s.route_id === currentRoute.id);
  const matchedShuttle = data.shuttles.find(s => s.id === currentRoute.shuttle_id) || data.shuttles[0];

  // Rota detay metnini güncelle
  const metaEl = document.getElementById('liveMapRouteMeta');
  if (metaEl) {
    const distText = currentRoute.total_distance_km ? `${currentRoute.total_distance_km} km` : 'Hesaplanıyor';
    const durText = currentRoute.total_duration_mins ? `~${currentRoute.total_duration_mins} dk` : '';
    const plateText = matchedShuttle ? `🚐 ${matchedShuttle.plate} (${matchedShuttle.driver_name || 'Şoför'})` : 'Servis';
    metaEl.innerHTML = `🛣️ <b>${currentRoute.route_name}</b> • ${distText} ${durText} • 📍 ${routeStops.length} Durak • ${plateText}`;
  }

  if (!liveMap) {
    liveMap = L.map('leafletMap', {
      zoomControl: true,
      attributionControl: false
    }).setView(targetCoord, 12);

    createOsmTileLayer().addTo(liveMap);
  } else {
    liveMap.invalidateSize();
    if (liveMapShuttleMarker) liveMap.removeLayer(liveMapShuttleMarker);
    if (liveMapGeofenceCircle) liveMap.removeLayer(liveMapGeofenceCircle);
    if (liveMapPolyline) liveMap.removeLayer(liveMapPolyline);
    liveMapStopMarkers.forEach(m => liveMap.removeLayer(m));
    liveMapStopMarkers = [];
  }

  // 1. Hedef Sanal Çiti Çiz
  liveMapGeofenceCircle = L.circle(targetCoord, {
    radius: comp.geofence_radius_meters || 180,
    color: '#f43f5e',
    fillColor: '#f43f5e',
    fillOpacity: 0.18,
    dashArray: '8, 8',
    weight: 2
  }).addTo(liveMap);

  const targetIcon = L.divIcon({
    className: 'custom-pin',
    html: `<div class="workplace-marker-icon">${isSchool ? '🏫' : '🏢'}</div>`,
    iconSize: [42, 42],
    iconAnchor: [21, 21]
  });

  L.marker(targetCoord, { icon: targetIcon })
    .bindPopup(`<b>${comp.workplace_name}</b><br>${isSchool ? 'Hedef Okul Kampüsü' : 'Hedef Fabrika / Tesis'}`)
    .addTo(liveMap);

  // 2. Durakları Çiz
  routeStops.forEach(st => {
    const stopIcon = L.divIcon({
      className: 'custom-pin',
      html: `<div class="stop-marker-icon">${st.stop_order}</div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13]
    });

    const m = L.marker([st.lat, st.lng], { icon: stopIcon })
      .bindPopup(`<b>${st.stop_name}</b><br>Biniş Saati: ${st.eta_time}`)
      .addTo(liveMap);

    liveMapStopMarkers.push(m);
  });

  // 3. Gerçek Yollardan Geçen Çizgiyi Çiz
  let roadPoints = [];
  if (currentRoute.road_geometry && Array.isArray(currentRoute.road_geometry) && currentRoute.road_geometry.length > 0) {
    roadPoints = currentRoute.road_geometry;
  } else {
    roadPoints = routeStops.map(s => [s.lat, s.lng]);
    roadPoints.push(targetCoord);
  }
  currentLiveRoadPoints = roadPoints;

  if (roadPoints.length > 1) {
    liveMapPolyline = L.polyline(roadPoints, {
      color: '#3b82f6',
      weight: 5,
      opacity: 0.85
    }).addTo(liveMap);

    liveMap.fitBounds(liveMapPolyline.getBounds(), { padding: [40, 40] });
  }

  // 4. Servis Aracını Başlangıç Noktasına Yerleştir
  const shuttleStart = roadPoints[0] || targetCoord;
  const shuttleIcon = L.divIcon({
    className: 'custom-pin',
    html: `<div class="shuttle-marker-icon" id="liveShuttleMarkerEl">🚐</div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19]
  });

  liveMapShuttleMarker = L.marker(shuttleStart, { icon: shuttleIcon })
    .bindPopup(`<b>${matchedShuttle ? matchedShuttle.plate : 'Servis'}</b><br>Şoför: ${matchedShuttle ? matchedShuttle.driver_name : 'Atanmadı'}<br>Kapasite: ${matchedShuttle ? matchedShuttle.capacity : 24} Kişi`)
    .addTo(liveMap);

  setTimeout(() => {
    if (liveMap) liveMap.invalidateSize();
  }, 250);

  startRealGpsPolling();
}

// Canlı Takip Simülasyonu (Yollar Boyunca Pürüzsüz İlerleme)
function simulateMethodBAutoStart() {
  if (!liveMapShuttleMarker) return;
  state.isLive = true;
  state.simulationStep = 0;
  const markerEl = document.getElementById('liveShuttleMarkerEl');
  if (markerEl) markerEl.classList.add('active-pulse');
  showToast("⚡ Yöntem B Devrede", "Servis saati (07:15) geldi. Şoför telefona dokunmasa bile canlı GPS akışı başladı.", "warning");
}

function toggleAutoDrive() {
  const btnText = document.getElementById('txtToggleAutoDrive');
  if (autoDriveInterval) {
    clearInterval(autoDriveInterval);
    autoDriveInterval = null;
    if (btnText) btnText.innerText = '▶️ Canlı Sürüşü Başlat';
    showToast("Sürüş Duraklatıldı", "Canlı simülasyon beklemeye alındı.", "info");
    return;
  }

  if (!state.isLive) {
    simulateMethodBAutoStart();
  }

  if (btnText) btnText.innerText = '⏸️ Sürüşü Duraklat';
  showToast("Canlı Sürüş Başladı", "Araç gerçek virajlar boyunca hedefe doğru ilerliyor...", "success");

  autoDriveInterval = setInterval(() => {
    const reachedEnd = stepShuttleProgress(true);
    if (reachedEnd) {
      clearInterval(autoDriveInterval);
      autoDriveInterval = null;
      if (btnText) btnText.innerText = '▶️ Canlı Sürüşü Başlat';
    }
  }, 450);
}

function stepShuttleProgress(isAuto = false) {
  if (!liveMap || !liveMapShuttleMarker || currentLiveRoadPoints.length === 0) return true;

  const totalPoints = currentLiveRoadPoints.length;
  // Manuel tıklandığında %8 atlar, otomatik sürüşte %3 veya 15 adım atlar
  const jump = isAuto ? Math.max(3, Math.floor(totalPoints / 30)) : Math.max(10, Math.floor(totalPoints / 12));

  if (state.simulationStep < totalPoints - 1) {
    state.simulationStep = Math.min(state.simulationStep + jump, totalPoints - 1);
    const targetCoord = currentLiveRoadPoints[state.simulationStep];
    liveMapShuttleMarker.setLatLng(targetCoord);
    liveMap.panTo(targetCoord);

    if (state.simulationStep >= totalPoints - 1) {
      simulateArrivalGeofence();
      return true;
    } else {
      if (!isAuto) {
        showToast("GPS Akışı", `Servis gerçek yol güzergahında ilerliyor (%${Math.round((state.simulationStep / totalPoints) * 100)}).`, "info");
      }
      return false;
    }
  } else {
    simulateArrivalGeofence();
    return true;
  }
}

function resetLiveSimulation() {
  if (autoDriveInterval) {
    clearInterval(autoDriveInterval);
    autoDriveInterval = null;
    const btnText = document.getElementById('txtToggleAutoDrive');
    if (btnText) btnText.innerText = '▶️ Canlı Sürüşü Başlat';
  }

  state.simulationStep = 0;
  state.isLive = false;

  if (liveMap && liveMapShuttleMarker && currentLiveRoadPoints.length > 0) {
    const startCoord = currentLiveRoadPoints[0];
    liveMapShuttleMarker.setLatLng(startCoord);
    liveMap.setView(startCoord, 13);
  }

  const markerEl = document.getElementById('liveShuttleMarkerEl');
  if (markerEl) markerEl.classList.remove('active-pulse');
  showToast("Sıfırlandı", "Servis başlangıç durağına geri çekildi.", "info");
}

function simulateArrivalGeofence() {
  if (autoDriveInterval) {
    clearInterval(autoDriveInterval);
    autoDriveInterval = null;
    const btnText = document.getElementById('txtToggleAutoDrive');
    if (btnText) btnText.innerText = '▶️ Canlı Sürüşü Başlat';
  }

  if (!liveMap || !liveMapShuttleMarker || !state.activeCompanyData) return;
  const comp = state.activeCompanyData.company;
  const targetCoord = [comp.workplace_lat, comp.workplace_lng];
  const isSchool = comp.operation_type === 'school';

  liveMapShuttleMarker.setLatLng(targetCoord);
  liveMap.setView(targetCoord, 14);
  state.isLive = false;
  state.simulationStep = currentLiveRoadPoints.length - 1;

  const markerEl = document.getElementById('liveShuttleMarkerEl');
  if (markerEl) markerEl.classList.remove('active-pulse');

  showToast(
    "🎯 Varış Noktasına Ulaştı",
    `${comp.workplace_name} sanal çitine girildi. ${isSchool ? 'Velilere "Öğrenci okula ulaştı" bildirimi iletildi.' : 'Personeller iş yerine vardı.'} Canlı GPS yayını kapatıldı.`,
    "success"
  );
}

// Telefondan Canlı Şoför GPS Takip Yoklayıcısı (Polling)
let realGpsPollingInterval = null;

function startRealGpsPolling() {
  if (realGpsPollingInterval) clearInterval(realGpsPollingInterval);
  
  realGpsPollingInterval = setInterval(async () => {
    if (!state.activeCompanyData || !state.activeRouteId || !liveMap || !liveMapShuttleMarker) return;
    const currentRoute = state.activeCompanyData.routes.find(r => r.id === state.activeRouteId);
    if (!currentRoute || !currentRoute.shuttle_id) return;

    try {
      const res = await fetch(`/api/shuttle/${currentRoute.shuttle_id}/location`);
      const data = await res.json();
      if (data.success && data.shuttle && data.shuttle.last_lat && data.shuttle.last_lng) {
        const phoneLat = data.shuttle.last_lat;
        const phoneLng = data.shuttle.last_lng;
        
        // Eğer telefon yayındaysa haritadaki servis pini telefonun olduğu yere taşınır!
        if (data.shuttle.current_status === 'running') {
          liveMapShuttleMarker.setLatLng([phoneLat, phoneLng]);
          const statusBadge = document.getElementById('liveMapStatusBadge');
          if (statusBadge) {
            statusBadge.innerText = '🟢 Şoför Telefondan Canlı Yayında (Gerçek GPS)';
            statusBadge.style.background = 'rgba(16, 185, 129, 0.2)';
            statusBadge.style.borderColor = 'rgba(16, 185, 129, 0.4)';
          }
        }
      }
    } catch (e) {}
  }, 3000);
}

// =========================================================================
// 7. SÜPER ADMİN: MÜŞTERİ OLUŞTURMA & YÖNETİMİ
// =========================================================================
function onOperationTypeChange(type) {
  const isSchool = type === 'school';
  const nameInput = document.getElementById('compInputName');
  const workplaceInput = document.getElementById('compInputWorkplace');
  const labelWorkplace = document.getElementById('labelNewCompanyWorkplace');

  if (isSchool) {
    nameInput.placeholder = "Örn: Bilfen Koleji veya Doğa Okulları";
    workplaceInput.value = "Merkez Okul & Kampüs";
    labelWorkplace.innerText = "Hedef Okul / Kampüs Adı";
  } else {
    nameInput.placeholder = "Örn: Borusan Boru Sanayi A.Ş.";
    workplaceInput.value = "Merkez Fabrika / Ofis";
    labelWorkplace.innerText = "Hedef Fabrika / Tesis Adı";
  }
}

async function loadSuperAdminCompanies() {
  try {
    const res = await fetch('/api/superadmin/companies');
    const data = await res.json();
    if (data.success) {
      state.companies = data.companies;
      renderAdminCustomersTable(data.companies);
    }
  } catch (err) {
    console.error('Müşteri listesi çekilemedi:', err);
  }
}

function renderAdminCustomersTable(companies) {
  const tbody = document.getElementById('tbodyAdminCustomers');
  document.getElementById('txtCustomerTotal').innerText = `${companies.length} Kayıt`;

  tbody.innerHTML = companies.map(c => {
    const isIntegration = c.service_type === 'integration';
    const isSchool = c.operation_type === 'school';

    const typeBadge = isIntegration 
      ? `<span class="badge-tag badge-integration">Entegrasyonlu</span>`
      : `<span class="badge-tag badge-portal">Siteden Takip</span>`;

    const opBadge = isSchool
      ? `<span class="badge-tag" style="background:rgba(245,158,11,0.15); color:#fbbf24; border:1px solid rgba(245,158,11,0.3);">🎓 Öğrenci</span>`
      : `<span class="badge-tag" style="background:rgba(59,130,246,0.15); color:#60a5fa; border:1px solid rgba(59,130,246,0.3);">🏢 Personel</span>`;

    const safeName = encodeURIComponent(c.company_name || '');

    return `
      <tr>
        <td>
          <b style="color:#fff; font-size:0.9rem;">${c.company_name}</b><br>
          <span style="font-size:0.75rem; color:var(--text-muted);">${c.workplace_name || 'Tesis'}</span>
        </td>
        <td>${opBadge}</td>
        <td>
          <span style="color:#e2e8f0;">${c.contact_person || '-'}</span><br>
          <span style="font-size:0.75rem; color:var(--accent-cyan);">${c.contact_email}</span>
        </td>
        <td>${typeBadge}</td>
        <td>
          <span style="font-size:0.8rem; color:var(--accent-amber);">Geofence: ${c.geofence_radius_meters || 180}m</span>
        </td>
        <td>
          <b>${c.total_shuttles || 0} Servis</b> / <span>${c.total_employees || 0} ${isSchool ? 'Öğrenci' : 'Personel'}</span>
        </td>
        <td>
          <button class="btn-action secondary" style="padding:0.3rem 0.65rem; font-size:0.75rem;" 
                  data-id="${c.id}" 
                  data-name="${safeName}" 
                  data-type="${c.service_type || 'portal'}" 
                  data-op="${c.operation_type || 'personnel'}"
                  onclick="handleImpersonateBtn(this)">
            Yönetim Paneli ➔
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function handleImpersonateBtn(btn) {
  const id = parseInt(btn.getAttribute('data-id'));
  const name = decodeURIComponent(btn.getAttribute('data-name'));
  const type = btn.getAttribute('data-type');
  const op = btn.getAttribute('data-op');
  impersonateCompany(id, name, type, op);
}

function impersonateCompany(companyId, companyName, serviceType, operationType) {
  state.activeCompanyId = companyId;
  const tempUser = {
    id: 999,
    role: 'company_admin',
    full_name: 'Müşteri Temsilcisi (Yönetici)',
    email: 'admin@servis360.com',
    company_id: companyId,
    company_name: companyName,
    service_type: serviceType,
    operation_type: operationType || 'personnel'
  };
  setupUserDashboard(tempUser);
  showToast("Yönetim Paneline Geçildi", `${companyName} ekranı yüklendi.`, "info");
}

async function handleCreateCompanySubmit(e) {
  e.preventDefault();

  const payload = {
    company_name: document.getElementById('compInputName').value.trim(),
    operation_type: document.getElementById('compInputOperationType').value,
    service_type: document.getElementById('compInputServiceType').value,
    contact_person: document.getElementById('compInputPerson').value.trim(),
    contact_email: document.getElementById('compInputEmail').value.trim(),
    admin_password: document.getElementById('compInputPassword').value.trim(),
    contact_phone: document.getElementById('compInputPhone').value.trim(),
    workplace_name: document.getElementById('compInputWorkplace').value.trim()
  };

  try {
    const res = await fetch('/api/superadmin/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Firma oluşturulamadı.');

    closeModal('modalCreateCompany');
    await loadSuperAdminCompanies();
    showToast("Müşteri Oluşturuldu", `${payload.company_name} hesabı açıldı.`, "success");
  } catch (err) {
    showToast("Hata", err.message, "danger");
  }
}

// =========================================================================
// 8. MÜŞTERİ PANELİ VERİLERİ (SERVİSLER, ROTALAR, ÖĞRENCİ/PERSONEL)
// =========================================================================
async function loadCompanyData(companyId) {
  try {
    const res = await fetch(`/api/company/${companyId}/dashboard`);
    const data = await res.json();
    if (data.success) {
      state.activeCompanyData = data;

      // Faaliyet türüne göre arayüzü uyarla (Personel vs Okul)
      adaptUiForOperationType(data.company.operation_type);

      // Fabrika/Okul verileri
      const comp = data.company;
      document.getElementById('wpInputName').value = comp.workplace_name || '';
      document.getElementById('wpInputLat').value = comp.workplace_lat || 41.1105;
      document.getElementById('wpInputLng').value = comp.workplace_lng || 29.0225;
      document.getElementById('wpInputGeofence').value = comp.geofence_radius_meters || 180;

      // Servisler
      renderCompanyShuttles(data.shuttles);

      // Rota Builder Servis Seçimi
      const routeShuttleSelect = document.getElementById('routeBuilderShuttleSelect');
      if (routeShuttleSelect) {
        if (data.shuttles.length === 0) {
          routeShuttleSelect.innerHTML = `<option value="">Önce Servis Araçları menüsünden araç ekleyin</option>`;
        } else {
          routeShuttleSelect.innerHTML = data.shuttles.map(s => `
            <option value="${s.id}">${s.plate} - ${s.driver_name || 'Şoför'} (${s.capacity} Kişilik)</option>
          `).join('');
        }
      }

      // Kayıtlı Rotalar
      renderCompanySavedRoutes(data.routes, data.stops);

      // Personeller / Öğrenciler
      renderCompanyEmployees(data.employees, comp.operation_type);

      // Modal Servis Seçimi
      const empShuttleSelect = document.getElementById('empInputShuttleSelect');
      if (empShuttleSelect) {
        empShuttleSelect.innerHTML = data.shuttles.map(s => `
          <option value="${s.id}">${s.plate} - ${s.driver_name || 'Şoför'} (${s.capacity} Kişilik)</option>
        `).join('');
      }
    }
  } catch (err) {
    console.error('Firma verileri çekilemedi:', err);
  }
}

function renderCompanyShuttles(shuttles) {
  const tbody = document.getElementById('tbodyCompanyShuttles');
  document.getElementById('txtCompanyShuttleTotal').innerText = `${shuttles.length} Araç`;
  document.getElementById('badgeShuttleCount').innerText = shuttles.length;

  if (shuttles.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">Henüz servis aracı tanımlanmamış.</td></tr>`;
    return;
  }

  tbody.innerHTML = shuttles.map(s => `
    <tr>
      <td><b style="color:#fff; font-size:0.9rem;">${s.plate}</b></td>
      <td>${s.model || 'Minibüs'}</td>
      <td><span class="badge-tag badge-portal">${s.capacity} Kişilik</span></td>
      <td>${s.driver_name || '-'}</td>
      <td>${s.driver_phone || '-'}</td>
      <td><b style="color:var(--accent-amber);">${s.shift_start_time || '07:15'}</b></td>
      <td><span class="badge-tag badge-success">Hazır</span></td>
    </tr>
  `).join('');
}

async function handleCreateShuttleSubmit(e) {
  e.preventDefault();
  const payload = {
    plate: document.getElementById('shuttleInputPlate').value.trim(),
    capacity: parseInt(document.getElementById('shuttleInputCapacity').value),
    model: document.getElementById('shuttleInputModel').value.trim(),
    driver_name: document.getElementById('shuttleInputDriverName').value.trim(),
    driver_phone: document.getElementById('shuttleInputDriverPhone').value.trim(),
    shift_start_time: document.getElementById('shuttleInputShiftTime').value
  };

  try {
    const res = await fetch(`/api/company/${state.activeCompanyId}/shuttles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Servis eklenemedi');

    closeModal('modalCreateShuttle');
    await loadCompanyData(state.activeCompanyId);
    showToast("Servis Eklendi", `${payload.plate} plakalı araç filoya eklendi.`, "success");
  } catch (err) {
    showToast("Hata", err.message, "danger");
  }
}

function renderCompanySavedRoutes(routes, stops) {
  const container = document.getElementById('companySavedRoutesList');
  if (routes.length === 0) {
    container.innerHTML = `<div style="color:var(--text-muted); font-size:0.85rem; padding:1rem 0;">Henüz tanımlı güzergah bulunmuyor. Yukarıdaki haritadan durak ekleyip gerçek yol rotası oluşturabilirsiniz.</div>`;
    return;
  }

  container.innerHTML = routes.map(r => {
    const routeStops = stops.filter(st => st.route_id === r.id);
    const distText = r.total_distance_km ? ` • 🛣️ ${r.total_distance_km} km` : '';
    const durText = r.total_duration_mins ? ` (~${r.total_duration_mins} dk)` : '';

    return `
      <div style="background: rgba(15,23,42,0.6); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 1.25rem; margin-bottom: 0.75rem;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
          <div>
            <h4 style="font-size:0.95rem; font-weight:700; color:#fff;">📍 ${r.route_name}</h4>
            <span style="font-size:0.75rem; color:#34d399;">Gerçek Yol Rotası${distText}${durText}</span>
          </div>
          <div style="display:flex; gap:0.5rem; align-items:center;">
            <span class="badge-tag badge-portal">${routeStops.length} Durak</span>
            <button class="btn-action secondary" style="padding:0.2rem 0.5rem; font-size:0.7rem; color:#fda4af;" onclick="deleteRoute(${r.id})">Sil</button>
          </div>
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:0.5rem;">
          ${routeStops.map(st => `
            <div style="display:inline-flex; align-items:center; gap:0.4rem; font-size:0.775rem; background:rgba(255,255,255,0.05); padding:0.3rem 0.6rem; border-radius:6px; color:#cbd5e1;">
              <span style="font-weight:700; color:var(--accent-cyan);">${st.stop_order}.</span>
              <span>${st.stop_name} (${st.eta_time || '07:30'})</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
}

async function deleteRoute(routeId) {
  if (!confirm('Bu rotayı silmek istediğinizden emin misiniz?')) return;
  try {
    const res = await fetch(`/api/company/${state.activeCompanyId}/routes/${routeId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Silinemedi');
    await loadCompanyData(state.activeCompanyId);
    showToast("Rota Silindi", "Güzergah başarıyla kaldırıldı.", "info");
  } catch (err) {
    showToast("Hata", err.message, "danger");
  }
}

// Personeller veya Öğrenciler/Velileri Tabloya Bas
function renderCompanyEmployees(employees, operationType) {
  const tbody = document.getElementById('tbodyCompanyEmployees');
  const isSchool = operationType === 'school';
  document.getElementById('txtCompanyEmployeeTotal').innerText = `${employees.length} ${isSchool ? 'Öğrenci' : 'Personel'}`;
  document.getElementById('badgeEmployeeCount').innerText = employees.length;

  if (employees.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">Henüz ${isSchool ? 'öğrenci' : 'personel'} kaydı yapılmamış.</td></tr>`;
    return;
  }

  if (isSchool) {
    tbody.innerHTML = employees.map(e => `
      <tr>
        <td><b style="color:#fff;">${e.full_name}</b></td>
        <td><span class="badge-tag" style="background:rgba(59,130,246,0.15); color:#60a5fa;">${e.student_class || 'Sınıf Yok'} / No: ${e.student_number || '-'}</span></td>
        <td><b>${e.parent_name || '-'}</b> <span style="font-size:0.75rem; color:var(--text-muted);">(${e.parent_relation || 'Veli'})</span></td>
        <td><span style="color:var(--accent-cyan);">${e.parent_phone || e.phone || '-'}</span></td>
        <td><span class="badge-tag badge-portal">${e.shuttle_plate || 'Atanmadı'}</span></td>
        <td>${e.stop_name || 'Durak Belirlenmedi'}</td>
        <td><span class="badge-tag badge-success">Servise Bindi</span></td>
      </tr>
    `).join('');
  } else {
    tbody.innerHTML = employees.map(e => `
      <tr>
        <td><b style="color:#fff;">${e.full_name}</b></td>
        <td>${e.department || 'Genel'}</td>
        <td>${e.phone || '-'}</td>
        <td><span class="badge-tag badge-portal">${e.shuttle_plate || 'Atanmadı'}</span></td>
        <td>${e.stop_name || 'Durak Belirlenmedi'}</td>
        <td><span class="badge-tag badge-success">Aktif</span></td>
      </tr>
    `).join('');
  }
}

// Personel veya Öğrenci/Veli Kaydetme
async function handleCreateEmployeeSubmit(e) {
  e.preventDefault();
  const isSchool = state.activeCompanyData && state.activeCompanyData.company.operation_type === 'school';
  const shuttleId = parseInt(document.getElementById('empInputShuttleSelect').value) || null;

  const payload = {
    full_name: document.getElementById('empInputFullName').value.trim(),
    passenger_type: isSchool ? 'student' : 'employee',
    shuttle_id: shuttleId,
    // Personel alanları
    department: isSchool ? null : document.getElementById('empInputDept').value.trim(),
    phone: isSchool ? null : document.getElementById('empInputPhone').value.trim(),
    // Öğrenci & Veli alanları
    student_class: isSchool ? document.getElementById('studentInputClass').value.trim() : null,
    student_number: isSchool ? document.getElementById('studentInputNumber').value.trim() : null,
    parent_name: isSchool ? document.getElementById('parentInputName').value.trim() : null,
    parent_phone: isSchool ? document.getElementById('parentInputPhone').value.trim() : null,
    parent_relation: isSchool ? document.getElementById('parentInputRelation').value : 'Veli'
  };

  try {
    const res = await fetch(`/api/company/${state.activeCompanyId}/employees`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Kaydedilemedi');

    closeModal('modalCreateEmployee');
    await loadCompanyData(state.activeCompanyId);
    showToast("Kayıt Eklendi", `${payload.full_name} (${isSchool ? 'Öğrenci & Veli' : 'Personel'}) servise kaydedildi.`, "success");
  } catch (err) {
    showToast("Hata", err.message, "danger");
  }
}

// =========================================================================
// 9. MODAL VE TOAST FONKSİYONLARI
// =========================================================================
function openModal(id) {
  document.getElementById(id).classList.add('active');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

function showToast(title, message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  
  let borderColor = type === 'danger' ? '#f43f5e' : (type === 'warning' ? '#f59e0b' : (type === 'success' ? '#10b981' : '#3b82f6'));
  let icon = type === 'danger' ? '⚠️' : (type === 'warning' ? '⚡' : (type === 'success' ? '✅' : 'ℹ️'));

  toast.style.cssText = `
    min-width: 320px;
    max-width: 420px;
    background: rgba(15, 23, 42, 0.95);
    backdrop-filter: blur(16px);
    border-left: 4px solid ${borderColor};
    border-top: 1px solid rgba(255,255,255,0.1);
    border-right: 1px solid rgba(255,255,255,0.1);
    border-bottom: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px;
    padding: 0.9rem 1.1rem;
    box-shadow: 0 10px 25px rgba(0,0,0,0.5);
    color: #fff;
    transform: translateX(120%);
    transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
  `;

  toast.innerHTML = `
    <div style="font-size: 1.25rem;">${icon}</div>
    <div style="flex: 1;">
      <div style="font-size: 0.85rem; font-weight: 700; margin-bottom: 0.2rem;">${title}</div>
      <div style="font-size: 0.775rem; color: #cbd5e1; line-height: 1.4;">${message}</div>
    </div>
  `;

  container.appendChild(toast);
  requestAnimationFrame(() => { toast.style.transform = 'translateX(0)'; });

  setTimeout(() => {
    toast.style.transform = 'translateX(120%)';
    setTimeout(() => { toast.remove(); }, 300);
  }, 4000);
}
