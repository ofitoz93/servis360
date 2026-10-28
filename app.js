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
  const savedAdmin = localStorage.getItem('servis360_admin_session');
  if (savedAdmin) {
    try {
      const user = JSON.parse(savedAdmin);
      state.currentUser = user;
      setupUserDashboard(user);
      return;
    } catch (e) {
      localStorage.removeItem('servis360_admin_session');
    }
  }
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

function setLoginType(type) {
  const tabAdmin = document.getElementById('tabLoginAdmin');
  const tabDriver = document.getElementById('tabLoginDriver');
  const label = document.getElementById('labelLoginUsername');
  const input = document.getElementById('inputEmail');
  const hint = document.getElementById('hintLoginUsername');
  const btn = document.getElementById('txtBtnLogin');

  if (type === 'driver') {
    tabAdmin.style.background = 'transparent';
    tabAdmin.style.color = 'var(--text-muted)';
    tabDriver.style.background = 'var(--accent-blue)';
    tabDriver.style.color = '#fff';

    label.innerText = 'Servis Plakası veya Personel ID';
    input.placeholder = 'Örn: 41 ABC 41 veya PRS-1005';
    hint.innerText = '* Şoför kokpitine doğrudan yönlendirileceksiniz.';
    btn.innerText = 'Şoför / Personel Olarak Giriş Yap';
  } else {
    tabDriver.style.background = 'transparent';
    tabDriver.style.color = 'var(--text-muted)';
    tabAdmin.style.background = 'var(--accent-blue)';
    tabAdmin.style.color = '#fff';

    label.innerText = 'Yönetici / İK E-posta Adresi';
    input.placeholder = 'Örn: admin@servis360.com';
    hint.innerText = '* Süper admin veya firma yönetim paneline erişim sağlar.';
    btn.innerText = 'Yönetici Olarak Giriş Yap';
  }
}

function quickHomeLogin(username, password) {
  document.getElementById('inputEmail').value = username;
  document.getElementById('inputPassword').value = password;
  document.getElementById('btnLoginSubmit').click();
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

    // Eğer Şoför veya Araç Girişiyse Doğrudan Şoför Kokpitine Yönlendir!
    if (data.is_driver || data.redirect === '/driver.html') {
      localStorage.setItem('servis360_driver_session', JSON.stringify({
        shuttle: data.shuttle,
        passengers: data.passengers
      }));
      showToast("🚗 Şoför Girişi Başarılı", `${data.shuttle.plate} kokpitine yönlendiriliyorsunuz...`, "success");
      setTimeout(() => {
        window.location.href = '/driver.html';
      }, 700);
      return;
    }

    // Yönetici / Firma Girişi (Şoför oturumunu ASLA ezmez, bağımsızdır)
    state.currentUser = data.user;
    localStorage.setItem('servis360_admin_session', JSON.stringify(data.user));
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
  localStorage.removeItem('servis360_admin_session');
  state.currentUser = null;
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
      <th>📱 Giriş Bilgileri (ID & Şifre)</th>
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
      <th>📱 Giriş Bilgileri (ID & Şifre)</th>
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
  } else if (viewName === 'companyTrips') {
    document.getElementById('btnNavCompanyTrips').classList.add('active');
    document.getElementById('viewCompanyTrips').classList.add('active');
    headingEl.innerText = 'Sefer Kayıtları & Yıllık Sefer Arşivi';
    subHeadingEl.innerText = 'Araçların gün bazında kalkış saati, varış saati, toplam sürüş süresi ve durak tamamlanma raporları';

    loadCompanyTrips();
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
function initWorkplacePickerMap(forcedLat, forcedLng, forcedRadius) {
  const container = document.getElementById('workplacePickerMap');
  if (!container) return;

  const comp = state.activeCompanyData ? state.activeCompanyData.company : null;
  const initialLat = forcedLat || (comp && comp.workplace_lat ? parseFloat(comp.workplace_lat) : parseFloat(document.getElementById('wpInputLat').value)) || 40.7241;
  const initialLng = forcedLng || (comp && comp.workplace_lng ? parseFloat(comp.workplace_lng) : parseFloat(document.getElementById('wpInputLng').value)) || 29.4939;
  const radius = forcedRadius || (comp && comp.geofence_radius_meters ? parseInt(comp.geofence_radius_meters) : parseInt(document.getElementById('wpInputGeofence').value)) || 180;
  const isSchool = comp && comp.operation_type === 'school';

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

    if (state.activeCompanyData && data.company) {
      state.activeCompanyData.company = { ...state.activeCompanyData.company, ...data.company };
    }
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
  const targetLat = comp && comp.workplace_lat ? parseFloat(comp.workplace_lat) : 40.7241;
  const targetLng = comp && comp.workplace_lng ? parseFloat(comp.workplace_lng) : 29.4939;
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

  // Eğer araç seçiliyse ve haritada henüz durak yoksa o aracın kayıtlı rotasını otomatik yükle
  const shuttleSelect = document.getElementById('routeBuilderShuttleSelect');
  if (shuttleSelect && shuttleSelect.value && routeBuilderStops.length === 0) {
    onRouteBuilderShuttleChange(shuttleSelect.value);
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
  routeBuilderMarkers.forEach(m => {
    if (routeBuilderMap) routeBuilderMap.removeLayer(m);
  });
  routeBuilderMarkers = [];
  routeBuilderStops = [];
  if (routeBuilderPolyline && routeBuilderMap) {
    routeBuilderMap.removeLayer(routeBuilderPolyline);
    routeBuilderPolyline = null;
  }
  calculatedRoadGeometry = [];
  const summaryBox = document.getElementById('routeCalculationSummaryBox');
  if (summaryBox) summaryBox.style.display = 'none';
  renderRouteBuilderStopsList();
}

// Araç Seçildiğinde O Araca Ait Mevcut Rotayı Haritaya Otomatik Yükle
function onRouteBuilderShuttleChange(shuttleId) {
  if (!shuttleId) {
    clearRouteBuilderStops();
    return;
  }
  const sId = parseInt(shuttleId);
  const data = state.activeCompanyData;
  if (!data || !data.routes) return;

  // Bu araca ait en güncel rotayı bul
  const matchedRoute = [...data.routes].reverse().find(r => r.shuttle_id === sId);
  if (matchedRoute) {
    loadRouteIntoBuilder(matchedRoute);
  } else {
    clearRouteBuilderStops();
    const matchedShuttle = (data.shuttles || []).find(s => s.id === sId);
    document.getElementById('routeBuilderNameInput').value = `${matchedShuttle ? matchedShuttle.plate : 'Servis'} Güzergahı`;
  }
}

// Kayıtlı Rotayı Rota Planlayıcı Haritasına Yükle
function loadRouteIntoBuilder(route) {
  clearRouteBuilderStops();

  const data = state.activeCompanyData;
  if (!data) return;

  // Bu rotaya ait durakları bul ve sırala
  const stops = (data.stops || []).filter(st => st.route_id === route.id).sort((a,b) => (a.stop_order || 0) - (b.stop_order || 0));

  const selectEl = document.getElementById('routeBuilderShuttleSelect');
  if (selectEl && route.shuttle_id) selectEl.value = route.shuttle_id;

  const nameInput = document.getElementById('routeBuilderNameInput');
  if (nameInput) nameInput.value = route.route_name || 'Servis Güzergahı';

  stops.forEach((st, idx) => {
    const stopObj = {
      id: st.id,
      order: st.stop_order || (idx + 1),
      stop_name: st.stop_name,
      lat: parseFloat(st.lat),
      lng: parseFloat(st.lng),
      eta_time: st.eta_time || '07:30'
    };
    routeBuilderStops.push(stopObj);

    if (routeBuilderMap) {
      const stopIcon = L.divIcon({
        className: 'custom-pin',
        html: `<div class="stop-marker-icon">${stopObj.order}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      });
      const marker = L.marker([stopObj.lat, stopObj.lng], { icon: stopIcon })
        .bindPopup(`<b>${stopObj.stop_name}</b><br>Biniş: ${stopObj.eta_time}`)
        .addTo(routeBuilderMap);
      routeBuilderMarkers.push(marker);
    }
  });

  // Yol geometrisini haritada çiz
  if (route.road_geometry && Array.isArray(route.road_geometry) && route.road_geometry.length > 0 && routeBuilderMap) {
    calculatedRoadGeometry = route.road_geometry;
    calculatedDistanceKm = route.total_distance_km || 0;
    calculatedDurationMins = route.total_duration_mins || 0;

    routeBuilderPolyline = L.polyline(calculatedRoadGeometry, {
      color: '#3b82f6',
      weight: 5,
      opacity: 0.85,
      lineJoin: 'round'
    }).addTo(routeBuilderMap);

    try {
      routeBuilderMap.fitBounds(routeBuilderPolyline.getBounds(), { padding: [40, 40] });
    } catch (e) {}

    const statsBox = document.getElementById('routeCalculationSummaryBox');
    const statsEl = document.getElementById('routeCalcStats');
    if (statsBox && statsEl) {
      statsEl.innerText = `${calculatedDistanceKm} km, ~${calculatedDurationMins} dakika`;
      statsBox.style.display = 'block';
    }
  } else if (routeBuilderMarkers.length > 0 && routeBuilderMap) {
    const group = L.featureGroup(routeBuilderMarkers);
    try {
      routeBuilderMap.fitBounds(group.getBounds(), { padding: [40, 40] });
    } catch (e) {}
  }

  renderRouteBuilderStopsList();
}

function loadSavedRouteToBuilder(routeId) {
  const data = state.activeCompanyData;
  if (!data || !data.routes) return;
  const r = data.routes.find(x => x.id === routeId);
  if (!r) return;

  navigateTo('companyRoutes');
  setTimeout(() => {
    loadRouteIntoBuilder(r);
    showToast("🗺️ Rota Yüklendi", `${r.route_name} haritada açıldı.`, "info");
    const builderCard = document.getElementById('viewCompanyRoutes');
    if (builderCard) builderCard.scrollIntoView({ behavior: 'smooth' });
  }, 300);
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
let allCompanyShuttleMarkers = {};

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

    // Rota seçici dropdown'u doldur (Başta TÜM ARAÇLAR seçeneği ile)
    const routeSelect = document.getElementById('liveMapRouteSelect');
    if (routeSelect) {
      if (!state.activeRouteId) {
        state.activeRouteId = 'all';
      }

      routeSelect.innerHTML = `
        <option value="all" ${state.activeRouteId === 'all' ? 'selected' : ''}>🌐 TÜM ARAÇLAR (Filo Genel Bakış)</option>
        ${data.routes.map(r => {
          const matchedS = data.shuttles.find(s => s.id === r.shuttle_id);
          const plateStr = matchedS ? `🚐 ${matchedS.plate}` : '🚐 Servis';
          const driverStr = (matchedS && matchedS.driver_name) ? ` (${matchedS.driver_name})` : '';
          const distStr = r.total_distance_km ? ` [~${r.total_distance_km} km]` : '';
          const liveStatus = (matchedS && matchedS.current_status === 'running') ? ' 🟢 [CANLI YAYIN]' : '';
          return `<option value="${r.id}" ${r.id === state.activeRouteId ? 'selected' : ''}>${plateStr} - ${r.route_name}${driverStr}${distStr}${liveStatus}</option>`;
        }).join('')}
      `;
    }

    setTimeout(() => {
      initLiveMapWithCompanyRoutes(data, state.activeRouteId);
    }, 200);
  }
}

const curHourNow = new Date().getHours();
let currentLiveDirection = curHourNow >= 12 ? 'evening' : 'morning'; // Saat 12:00'den sonraysa otomatik akşam, öncesiyse sabah

function setLiveMapDirection(dir) {
  currentLiveDirection = dir;
  const btnMorn = document.getElementById('btnLiveDirMorning');
  const btnEve = document.getElementById('btnLiveDirEvening');

  if (dir === 'evening') {
    if (btnEve) { btnEve.className = 'btn-action primary'; }
    if (btnMorn) { btnMorn.className = 'btn-action secondary'; }
    showToast("🌇 Akşam Dağıtım Modu", "Güzergah fabrikadan başlayıp sabahki 1. durağa doğru ters istikamete çevrildi.", "info");
  } else {
    if (btnMorn) { btnMorn.className = 'btn-action primary'; }
    if (btnEve) { btnEve.className = 'btn-action secondary'; }
    showToast("🌅 Sabah Toplama Modu", "Güzergah duraklardan fabrikaya doğru ayarlandı.", "info");
  }

  resetLiveSimulation();
  if (state.activeCompanyData) {
    initLiveMapWithCompanyRoutes(state.activeCompanyData, state.activeRouteId);
  }
}

function onLiveMapRouteChange(routeId) {
  state.activeRouteId = routeId === 'all' ? 'all' : parseInt(routeId);
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

  // 1. TÜM ARAÇLARI İZLEME MODU (targetRouteId === 'all')
  if (targetRouteId === 'all') {
    const metaEl = document.getElementById('liveMapRouteMeta');
    if (metaEl) {
      metaEl.innerHTML = `🛣️ <b>Tüm Şirket Filosu Canlı İzleniyor</b> • 📍 Aşağıdaki haritada ve kartlarda tüm servisler gerçek zamanlı sinyalleriyle gösterilmektedir.`;
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
      Object.values(allCompanyShuttleMarkers).forEach(m => liveMap.removeLayer(m));
      allCompanyShuttleMarkers = {};
    }

    // Hedef Sanal Çiti Çiz
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
      .bindPopup(`<b>${comp.workplace_name}</b><br>${isSchool ? 'Okul Kampüsü' : 'Fabrika / Tesis'}`)
      .addTo(liveMap);

    startRealGpsPolling();
    return;
  }

  // 2. TEKİL ROTA İZLEME MODU
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
    const dirText = currentLiveDirection === 'evening' ? '🌇 Akşam: Fabrikadan ➔ 1. Durağa (Dağıtım)' : '🌅 Sabah: 1. Duraktan ➔ Fabrikaya (Toplama)';
    metaEl.innerHTML = `🛣️ <b>${currentRoute.route_name}</b> [${dirText}] • ${distText} ${durText} • 📍 ${routeStops.length} Durak • ${plateText}`;
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
    Object.values(allCompanyShuttleMarkers).forEach(m => liveMap.removeLayer(m));
    allCompanyShuttleMarkers = {};
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
    .bindPopup(`<b>${comp.workplace_name}</b><br>${isSchool ? 'Okul Kampüsü' : 'Fabrika / Tesis'}`)
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
      .bindPopup(`<b>${st.stop_name}</b><br>Biniş/İniş Saati: ${st.eta_time}`)
      .addTo(liveMap);

    liveMapStopMarkers.push(m);
  });

  // 3. Gerçek Yollardan Geçen Çizgiyi Çiz (Akşam ise ters çevir!)
  let roadPoints = [];
  if (currentRoute.road_geometry && Array.isArray(currentRoute.road_geometry) && currentRoute.road_geometry.length > 0) {
    roadPoints = currentLiveDirection === 'evening' 
      ? [...currentRoute.road_geometry].reverse() 
      : [...currentRoute.road_geometry];
  } else {
    const basePts = routeStops.map(s => [s.lat, s.lng]);
    basePts.push(targetCoord);
    roadPoints = currentLiveDirection === 'evening' ? [...basePts].reverse() : basePts;
  }
  currentLiveRoadPoints = roadPoints;

  if (roadPoints.length > 1) {
    liveMapPolyline = L.polyline(roadPoints, {
      color: currentLiveDirection === 'evening' ? '#f59e0b' : '#3b82f6',
      weight: 5,
      opacity: 0.9,
      dashArray: currentLiveDirection === 'evening' ? '12, 6' : null
    }).addTo(liveMap);

    liveMap.fitBounds(liveMapPolyline.getBounds(), { padding: [40, 40] });
  }

  // 4. Servis Aracını Sadece Gerçek Koordinatı Varsa Haritaya Yerleştir (Asla 1. durağa uydurma konum atamaz!)
  const hasRealCoords = matchedShuttle && matchedShuttle.last_lat && matchedShuttle.last_lng;
  const isRunning = matchedShuttle && matchedShuttle.current_status === 'running';

  if (hasRealCoords) {
    const shuttleStart = [parseFloat(matchedShuttle.last_lat), parseFloat(matchedShuttle.last_lng)];
    const shuttleIcon = L.divIcon({
      className: 'custom-pin',
      html: `<div class="shuttle-marker-icon ${isRunning ? 'active-pulse' : ''}" id="liveShuttleMarkerEl" style="${isRunning ? 'border: 2px solid #10b981; background: #064e3b;' : ''}">
        🚐
        <div style="position: absolute; bottom: -20px; left: 50%; transform: translateX(-50%); font-size: 11px; font-weight: 800; background: #0f172a; padding: 2px 6px; border-radius: 6px; border: 1px solid ${isRunning ? '#10b981' : '#3b82f6'}; color: ${isRunning ? '#34d399' : '#fff'}; white-space: nowrap; box-shadow: 0 4px 10px rgba(0,0,0,0.5);">
          ${matchedShuttle ? matchedShuttle.plate : 'Servis'} ${isRunning ? '🟢 CANLI' : ''}
        </div>
      </div>`,
      iconSize: [38, 38],
      iconAnchor: [19, 19]
    });

    const matchedRouteObj = data.routes.find(r => r.id === targetRouteId);
    const routeDistStr = matchedRouteObj && matchedRouteObj.total_distance_km ? ` (~${matchedRouteObj.total_distance_km} km)` : '';

    liveMapShuttleMarker = L.marker(shuttleStart, { icon: shuttleIcon })
      .bindPopup(`
        <div style="font-family:'Plus Jakarta Sans',sans-serif; min-width:200px;">
          <div style="font-size:13px; font-weight:800; color:#fff; display:flex; align-items:center; gap:6px;">
            <span>🚐</span> <span>${matchedShuttle ? matchedShuttle.plate : 'Servis'}</span>
            ${isRunning ? '<span style="font-size:10px; color:#34d399; background:rgba(16,185,129,0.2); padding:1px 6px; border-radius:4px; font-weight:700;">CANLI</span>' : ''}
          </div>
          <div style="font-size:11px; color:#cbd5e1; margin-top:5px;"><b>Şoför:</b> ${matchedShuttle ? matchedShuttle.driver_name : 'Atanmadı'} (${matchedShuttle ? (matchedShuttle.driver_phone || '-') : ''})</div>
          <div style="font-size:11px; color:#cbd5e1;"><b>Rota:</b> ${matchedRouteObj ? matchedRouteObj.route_name : 'Aktif Rota'}${routeDistStr}</div>
          <div style="font-size:11px; color:#cbd5e1;"><b>Durak Sayısı:</b> ${routeStops.length} Durak</div>
          <div style="font-size:11px; color:#cbd5e1;"><b>İstikamet:</b> ${currentLiveDirection === 'evening' ? 'Akşam Dönüşü (Fabrika ➔ Evler)' : 'Sabah Servisi (Evler ➔ Fabrika)'}</div>
          <button type="button" class="btn-action secondary" onclick="showShuttleRouteOnLiveMap('all')" style="width:100%; margin-top:8px; padding:6px; font-size:11px; justify-content:center; cursor:pointer;">
            🌐 Tüm Filo Görünümüne Dön
          </button>
        </div>
      `)
      .addTo(liveMap);
  }

  setTimeout(() => {
    if (liveMap) liveMap.invalidateSize();
  }, 250);

  startRealGpsPolling();
}

// Demo simülasyonları kaldırıldı - Yalnızca gerçek telefon GPS yayını çalışır
state.liveFleetFilter = 'running'; // 'running' (sadece seferdekiler) veya 'all' (tüm filo)
state.lastFleetShuttles = [];

window.setFleetLiveFilter = function(filter) {
  state.liveFleetFilter = filter;
  const btnRunning = document.getElementById('btnFleetFilterRunning');
  const btnAll = document.getElementById('btnFleetFilterAll');
  if (btnRunning && btnAll) {
    if (filter === 'running') {
      btnRunning.className = 'btn-action primary';
      btnAll.className = 'btn-action secondary';
    } else {
      btnRunning.className = 'btn-action secondary';
      btnAll.className = 'btn-action primary';
    }
  }
  if (state.lastFleetShuttles && state.lastFleetShuttles.length > 0) {
    renderFleetLiveCards(state.lastFleetShuttles);
  }
};

// Telefondan Canlı Şoför GPS Takip Yoklayıcısı (Polling - Sadece Canlı Seferdeki Araçları İzler)
let realGpsPollingInterval = null;

function startRealGpsPolling() {
  if (realGpsPollingInterval) clearInterval(realGpsPollingInterval);
  
  realGpsPollingInterval = setInterval(async () => {
    if (!state.activeCompanyData || !liveMap) return;
    const compId = state.activeCompanyData.company.id;

    try {
      const res = await fetch(`/api/company/${compId}/shuttles/live-locations`);
      const data = await res.json();
      if (data.success && Array.isArray(data.shuttles)) {
        let activeLivePlates = [];

        // Filo kartlarını güncelle
        renderFleetLiveCards(data.shuttles);

        data.shuttles.forEach(s => {
          if (!s.last_lat || !s.last_lng) return;
          const latLng = [parseFloat(s.last_lat), parseFloat(s.last_lng)];

          const isCurrentRouteShuttle = state.activeCompanyData && state.activeRouteId && state.activeRouteId !== 'all' && (() => {
            const currentRoute = state.activeCompanyData.routes.find(r => r.id === state.activeRouteId);
            return currentRoute && currentRoute.shuttle_id === s.id;
          })();

          if (s.current_status === 'running') {
            activeLivePlates.push(s.plate);
          }

          // Seçili rotanın aracı ise ana marker'ı güncelle
          if (isCurrentRouteShuttle && liveMapShuttleMarker) {
            liveMapShuttleMarker.setLatLng(latLng);
            const markerEl = document.getElementById('liveShuttleMarkerEl');
            if (markerEl) {
              if (s.current_status === 'running') {
                markerEl.classList.add('active-pulse');
                markerEl.style.border = '2px solid #10b981';
                markerEl.style.background = '#064e3b';
              } else {
                markerEl.classList.remove('active-pulse');
              }
            }
          } else {
            // TÜM şirket araçlarını haritada gösterme modu
            const isOtherRunning = s.current_status === 'running';

            // Eğer sadece canlı araçlar filtresi seçiliyse ve araç seferde değilse haritada gösterme!
            if (state.liveFleetFilter === 'running' && !isOtherRunning) {
              if (allCompanyShuttleMarkers[s.id]) {
                liveMap.removeLayer(allCompanyShuttleMarkers[s.id]);
                delete allCompanyShuttleMarkers[s.id];
              }
              return;
            }

            const isArrived = s.current_status === 'arrived' || s.current_status === 'completed';
            const statusColor = isOtherRunning ? '#10b981' : (isArrived ? '#3b82f6' : '#64748b');

            if (!allCompanyShuttleMarkers[s.id]) {
              const otherIcon = L.divIcon({
                className: 'custom-pin',
                html: `<div class="shuttle-marker-icon ${isOtherRunning ? 'active-pulse' : ''}" style="${isOtherRunning ? 'border: 2px solid #10b981; background: #064e3b; cursor:pointer;' : 'background: #1e293b; opacity:0.95; cursor:pointer;'}">
                  🚐
                  <div style="position: absolute; bottom: -18px; left: 50%; transform: translateX(-50%); font-size: 10px; font-weight: 800; background: #0f172a; padding: 1px 5px; border-radius: 5px; border: 1px solid ${statusColor}; color: ${isOtherRunning ? '#34d399' : '#cbd5e1'}; white-space: nowrap; box-shadow: 0 4px 10px rgba(0,0,0,0.5);">
                    ${s.plate} ${isOtherRunning ? '🟢' : ''}
                  </div>
                </div>`,
                iconSize: [34, 34],
                iconAnchor: [17, 17]
              });

              const matchedRoute = (state.activeCompanyData?.routes || []).find(r => r.shuttle_id === s.id);
              const routeName = matchedRoute ? matchedRoute.route_name : 'Kayıtlı Rota';

              const marker = L.marker(latLng, { icon: otherIcon })
                .bindPopup(`
                  <div style="font-family:'Plus Jakarta Sans',sans-serif; min-width:190px;">
                    <div style="font-size:13px; font-weight:800; color:#fff; display:flex; align-items:center; gap:6px;">
                      <span>🚐</span> <span>${s.plate}</span>
                      ${isOtherRunning ? '<span style="font-size:10px; color:#34d399; background:rgba(16,185,129,0.2); padding:1px 6px; border-radius:4px; font-weight:700;">CANLI</span>' : ''}
                    </div>
                    <div style="font-size:11px; color:#94a3b8; margin-top:4px;"><b>Şoför:</b> ${s.driver_name || 'Şoför'} (${s.driver_phone || '-'})</div>
                    <div style="font-size:11px; color:#94a3b8;"><b>Rota:</b> ${routeName}</div>
                    <div style="font-size:11px; color:#94a3b8;"><b>Saat:</b> ${s.shift_start_time || '07:15'} - ${s.return_time || '16:45'}</div>
                    <button type="button" class="btn-action primary" onclick="showShuttleRouteOnLiveMap(${s.id})" style="width:100%; margin-top:8px; padding:6px; font-size:11px; justify-content:center; cursor:pointer;">
                      🗺️ Rotasını Haritada Göster
                    </button>
                  </div>
                `)
                .addTo(liveMap);

              // ARACIN ÜSTÜNE TIKLAYINCA ROTASINI VE DURAKLARINI GÖSTER
              marker.on('click', () => {
                showShuttleRouteOnLiveMap(s.id);
              });

              allCompanyShuttleMarkers[s.id] = marker;
            } else {
              allCompanyShuttleMarkers[s.id].setLatLng(latLng);
            }
          }
        });

        // Üst durum etiketini güncelle
        const statusBadge = document.getElementById('liveMapStatusBadge');
        if (statusBadge) {
          if (activeLivePlates.length > 0) {
            statusBadge.innerText = `🟢 ${activeLivePlates.join(', ')} Canlı Yayında (Gerçek GPS)`;
            statusBadge.style.background = 'rgba(16, 185, 129, 0.2)';
            statusBadge.style.borderColor = 'rgba(16, 185, 129, 0.4)';
            statusBadge.style.color = '#34d399';
          } else {
            statusBadge.innerText = '⏳ Araçlar Beklemede / Sefer Saati Bekleniyor';
            statusBadge.style.background = 'rgba(245, 158, 11, 0.15)';
            statusBadge.style.borderColor = 'rgba(245, 158, 11, 0.3)';
            statusBadge.style.color = '#fbbf24';
          }
        }
      }
    } catch (e) {
      console.warn('Canlı konum yoklama hatası:', e);
    }
  }, 2500);
}

function renderFleetLiveCards(shuttles) {
  state.lastFleetShuttles = shuttles;
  const container = document.getElementById('containerFleetLiveCards');
  const countEl = document.getElementById('txtFleetLiveCount');
  if (!container || !Array.isArray(shuttles)) return;

  const isFilterRunningOnly = state.liveFleetFilter === 'running';
  const displayedShuttles = isFilterRunningOnly 
    ? shuttles.filter(s => s.current_status === 'running')
    : shuttles;

  const runningCount = shuttles.filter(s => s.current_status === 'running').length;
  if (countEl) {
    countEl.innerText = `${runningCount} Canlı / ${shuttles.length} Araç`;
  }

  if (displayedShuttles.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 2rem 1.5rem; text-align: center; background: rgba(15,23,42,0.4); border: 1px dashed var(--border-color); border-radius: 12px; color: var(--text-muted);">
        <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">⏳</div>
        <div style="font-size: 0.95rem; font-weight: 700; color: #fff; margin-bottom: 0.35rem;">Şu Anda Seferde Olan Canlı Araç Bulunmuyor</div>
        <div style="font-size: 0.8rem; line-height: 1.5; max-width: 450px; margin: 0 auto;">
          Şoför uygulamadan canlı konumu açtığında veya sefer saati geldiğinde araçlar burada anlık belirecektir.<br>
          Bekleyen diğer araçları incelemek için yukarıdan <button type="button" class="btn-action secondary" onclick="setFleetLiveFilter('all')" style="padding: 2px 8px; font-size: 0.75rem; display: inline-flex; vertical-align: middle;">🌐 Tüm Araçlar</button> seçeneğine tıklayabilirsiniz.
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = displayedShuttles.map(s => {
    const isLive = s.current_status === 'running';
    const isArrived = s.current_status === 'arrived' || s.current_status === 'completed';
    const borderStyle = isLive 
      ? 'border: 1px solid #10b981; background: rgba(16, 185, 129, 0.08);' 
      : 'border: 1px solid var(--border-color); background: rgba(255, 255, 255, 0.03);';
    const badgeText = isLive ? '🟢 CANLI YAYINDA' : (isArrived ? '🏁 TAMAMLANDI' : '⏳ BEKLEMEDE');
    const badgeColor = isLive ? '#34d399' : (isArrived ? '#60a5fa' : '#fbbf24');
    const hasCoords = s.last_lat && s.last_lng;

    return `
      <div style="padding: 0.85rem; border-radius: 12px; ${borderStyle} display: flex; flex-direction: column; justify-content: space-between;">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.35rem;">
            <div>
              <div style="font-family: 'Fira Code', monospace; font-size: 1.05rem; font-weight: 800; color: #fff;">${s.plate}</div>
              <div style="font-size: 0.725rem; color: var(--text-muted);">${s.model || 'Servis Aracı'} (${s.capacity || 24} Kişi)</div>
            </div>
            <span style="font-size: 0.65rem; font-weight: 800; color: ${badgeColor}; background: rgba(0,0,0,0.3); padding: 0.2rem 0.45rem; border-radius: 4px; border: 1px solid ${badgeColor};">
              ${badgeText}
            </span>
          </div>

          <div style="font-size: 0.75rem; color: #cbd5e1; margin-top: 0.5rem; line-height: 1.5;">
            <div>👤 <b>Şoför:</b> ${s.driver_name || 'Atanmadı'}</div>
            <div>⏰ <b>Sefer Saatleri:</b> Sabah: ${s.shift_start_time || '07:15'} • Dönüş: ${s.return_time || '16:45'}</div>
            <div>📍 <b>Son Sinyal:</b> ${hasCoords ? `${Number(s.last_lat).toFixed(4)}, ${Number(s.last_lng).toFixed(4)}` : 'Henüz GPS sinyali yok'}</div>
          </div>
        </div>

        <div style="margin-top: 0.75rem; display: flex; gap: 0.4rem;">
          <button type="button" class="btn-action primary" onclick="showShuttleRouteOnLiveMap(${s.id})" style="flex: 1; padding: 0.45rem 0.5rem; font-size: 0.75rem; justify-content: center;">
            🗺️ Rotayı & Canlı Takibi Aç
          </button>
          ${hasCoords ? `
            <button type="button" class="btn-action secondary" onclick="focusOnShuttleMarker(${s.id}, ${s.last_lat}, ${s.last_lng})" style="padding: 0.45rem 0.6rem; font-size: 0.75rem; justify-content: center;" title="Araca Yakınlaş">
              🔍
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// Canlı Takipte Aracın Üstüne Tıklayınca Rotasını Yükleme ve Gösterme
window.showShuttleRouteOnLiveMap = function(shuttleId) {
  if (!state.activeCompanyData || !liveMap) return;
  const data = state.activeCompanyData;

  if (shuttleId === 'all') {
    state.activeRouteId = 'all';
    const routeSelect = document.getElementById('liveMapRouteSelect');
    if (routeSelect) routeSelect.value = 'all';
    initLiveMapWithCompanyRoutes(data, 'all');
    showToast("🌐 Filo Genel Bakış", "Tüm araçlar haritada gösteriliyor.", "info");
    return;
  }

  const sId = parseInt(shuttleId);
  const matchedShuttle = (data.shuttles || []).find(s => s.id === sId);
  const matchedRoute = (data.routes || []).find(r => r.shuttle_id === sId) || (data.routes || [])[0];

  if (!matchedRoute) {
    showToast("Rota Bulunamadı", `${matchedShuttle ? matchedShuttle.plate : 'Bu servis'} için kayıtlı bir güzergah bulunamadı.`, "warning");
    return;
  }

  // Dropdown'u güncelle
  state.activeRouteId = matchedRoute.id;
  const routeSelect = document.getElementById('liveMapRouteSelect');
  if (routeSelect) {
    routeSelect.value = matchedRoute.id;
  }

  // Haritayı seçili rotayla çiz
  initLiveMapWithCompanyRoutes(data, matchedRoute.id);

  // Araca odaklan ve popup aç
  if (matchedShuttle && matchedShuttle.last_lat && matchedShuttle.last_lng) {
    const latLng = [parseFloat(matchedShuttle.last_lat), parseFloat(matchedShuttle.last_lng)];
    setTimeout(() => {
      if (liveMapShuttleMarker) {
        liveMapShuttleMarker.openPopup();
      }
    }, 350);
  }

  showToast(
    `🗺️ ${matchedShuttle ? matchedShuttle.plate : 'Araç'} Rotası Yüklendi`,
    `${matchedRoute.route_name} güzergahı ve durakları harita üzerinde gösteriliyor.`,
    "success"
  );
};

window.focusOnShuttleMarker = function(shuttleId, lat, lng) {
  if (!liveMap) return;
  liveMap.setView([lat, lng], 15);
  if (allCompanyShuttleMarkers[shuttleId]) {
    allCompanyShuttleMarkers[shuttleId].openPopup();
  } else if (liveMapShuttleMarker) {
    liveMapShuttleMarker.openPopup();
  }
};

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
      document.getElementById('wpInputLat').value = comp.workplace_lat || 40.7241;
      document.getElementById('wpInputLng').value = comp.workplace_lng || 29.4939;
      document.getElementById('wpInputGeofence').value = comp.geofence_radius_meters || 180;

      // Fabrika/Okul haritasını veritabanındaki gerçek koordinatlara odakla
      if (comp.workplace_lat && comp.workplace_lng) {
        initWorkplacePickerMap(parseFloat(comp.workplace_lat), parseFloat(comp.workplace_lng), parseInt(comp.geofence_radius_meters) || 180);
      }

      // Servisler
      renderCompanyShuttles(data.shuttles);

      // Rota Builder Servis Seçimi
      const routeShuttleSelect = document.getElementById('routeBuilderShuttleSelect');
      if (routeShuttleSelect) {
        if (data.shuttles.length === 0) {
          routeShuttleSelect.innerHTML = `<option value="">Önce Servis Araçları menüsünden araç ekleyin</option>`;
        } else {
          const prevVal = routeShuttleSelect.value;
          routeShuttleSelect.innerHTML = data.shuttles.map(s => `
            <option value="${s.id}">${s.plate} - ${s.driver_name || 'Şoför'} (${s.capacity} Kişilik)</option>
          `).join('');

          const targetShuttleId = prevVal ? parseInt(prevVal) : data.shuttles[0].id;
          routeShuttleSelect.value = targetShuttleId;
          setTimeout(() => {
            onRouteBuilderShuttleChange(targetShuttleId);
          }, 350);
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

  tbody.innerHTML = shuttles.map(s => {
    const driverUser = s.driver_username || (s.plate || '').replace(/\s+/g, '').toUpperCase();
    const driverPass = s.driver_password || '123456';
    const sJson = encodeURIComponent(JSON.stringify(s));

    return `
      <tr>
        <td><b style="color:#fff; font-size:0.9rem; font-family:'Fira Code', monospace;">${s.plate}</b></td>
        <td>
          <span style="color:#e2e8f0;">${s.model || 'Minibüs'}</span><br>
          <span class="badge-tag badge-portal" style="font-size:0.7rem;">${s.capacity} Kişilik</span>
        </td>
        <td>
          <span style="font-weight:600; color:#fff;">${s.driver_name || '-'}</span><br>
          <span style="font-size:0.75rem; color:var(--accent-cyan);">${s.driver_phone || '-'}</span>
        </td>
        <td><b style="color:var(--accent-amber);">🌅 ${s.shift_start_time || '07:15'}</b></td>
        <td><b style="color:#60a5fa;">🌇 ${s.return_time || '17:30'}</b></td>
        <td>
          <span style="font-size:0.75rem; color:#cbd5e1; font-family:'Fira Code', monospace;">ID: <b>${driverUser}</b></span><br>
          <span style="font-size:0.75rem; color:#34d399; font-family:'Fira Code', monospace;">Şifre: <b>${driverPass}</b></span>
        </td>
        <td>
          <button class="btn-action secondary" style="padding:0.3rem 0.65rem; font-size:0.75rem;" onclick="openEditShuttleModal('${sJson}')">
            ✏️ Düzenle
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function openEditShuttleModal(encodedShuttle) {
  const s = JSON.parse(decodeURIComponent(encodedShuttle));
  document.getElementById('editShuttleId').value = s.id;
  document.getElementById('editShuttlePlate').value = s.plate;
  document.getElementById('editShuttleCapacity').value = s.capacity;
  document.getElementById('editShuttleModel').value = s.model || 'Mercedes-Benz Sprinter';
  document.getElementById('editShuttleDriverName').value = s.driver_name || '';
  document.getElementById('editShuttleDriverPhone').value = s.driver_phone || '';
  document.getElementById('editShuttleShiftTime').value = s.shift_start_time || '07:15';
  document.getElementById('editShuttleReturnTime').value = s.return_time || '17:30';
  document.getElementById('editShuttlePassword').value = s.driver_password || '123456';

  openModal('modalEditShuttle');
}

async function handleEditShuttleSubmit(e) {
  e.preventDefault();
  const shuttleId = document.getElementById('editShuttleId').value;
  const payload = {
    plate: document.getElementById('editShuttlePlate').value.trim(),
    capacity: parseInt(document.getElementById('editShuttleCapacity').value),
    model: document.getElementById('editShuttleModel').value.trim(),
    driver_name: document.getElementById('editShuttleDriverName').value.trim(),
    driver_phone: document.getElementById('editShuttleDriverPhone').value.trim(),
    shift_start_time: document.getElementById('editShuttleShiftTime').value,
    return_time: document.getElementById('editShuttleReturnTime').value,
    driver_password: document.getElementById('editShuttlePassword').value.trim()
  };

  try {
    const res = await fetch(`/api/company/${state.activeCompanyId}/shuttles/${shuttleId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Güncellenemedi');

    closeModal('modalEditShuttle');
    await loadCompanyData(state.activeCompanyId);
    showToast("Servis Güncellendi", `${payload.plate} bilgileri ve sefer saatleri kaydedildi.`, "success");
  } catch (err) {
    showToast("Hata", err.message, "danger");
  }
}

async function handleCreateShuttleSubmit(e) {
  e.preventDefault();
  const payload = {
    plate: document.getElementById('shuttleInputPlate').value.trim(),
    capacity: parseInt(document.getElementById('shuttleInputCapacity').value),
    model: document.getElementById('shuttleInputModel').value.trim(),
    driver_name: document.getElementById('shuttleInputDriverName').value.trim(),
    driver_phone: document.getElementById('shuttleInputDriverPhone').value.trim(),
    shift_start_time: document.getElementById('shuttleInputShiftTime').value,
    return_time: document.getElementById('shuttleInputReturnTime').value,
    driver_password: document.getElementById('shuttleInputPassword').value.trim()
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
            <button class="btn-action primary" style="padding:0.25rem 0.65rem; font-size:0.725rem;" onclick="loadSavedRouteToBuilder(${r.id})">🗺️ Haritada Yükle / Düzenle</button>
            <button class="btn-action secondary" style="padding:0.25rem 0.5rem; font-size:0.725rem; color:#fda4af;" onclick="deleteRoute(${r.id})">Sil</button>
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

// Personeller veya Öğrenciler/Velileri Tabloya Bas (ID & Şifre Bilgisiyle)
function renderCompanyEmployees(employees, operationType) {
  const tbody = document.getElementById('tbodyCompanyEmployees');
  const isSchool = operationType === 'school';
  document.getElementById('txtCompanyEmployeeTotal').innerText = `${employees.length} ${isSchool ? 'Öğrenci' : 'Personel'}`;
  document.getElementById('badgeEmployeeCount').innerText = employees.length;

  if (employees.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-muted);">Henüz ${isSchool ? 'öğrenci' : 'personel'} kaydı yapılmamış.</td></tr>`;
    return;
  }

  if (isSchool) {
    tbody.innerHTML = employees.map(e => {
      const loginId = e.login_id || ('PRS-' + (1000 + e.id));
      const loginPass = e.login_pass || '123456';
      const isDriver = e.role === 'driver';

      return `
        <tr>
          <td><b style="color:#fff;">${e.full_name}</b></td>
          <td><span class="badge-tag" style="background:rgba(59,130,246,0.15); color:#60a5fa;">${e.student_class || 'Sınıf Yok'} / No: ${e.student_number || '-'}</span></td>
          <td><b>${e.parent_name || '-'}</b> <span style="font-size:0.75rem; color:var(--text-muted);">(${e.parent_relation || 'Veli'})</span></td>
          <td><span style="color:var(--accent-cyan);">${e.parent_phone || e.phone || '-'}</span></td>
          <td><span class="badge-tag badge-portal">${e.shuttle_plate || 'Atanmadı'}</span></td>
          <td>${e.stop_name || 'Durak Belirlenmedi'}</td>
          <td>
            ${isDriver ? '<span class="badge-tag" style="background:rgba(16,185,129,0.2); color:#34d399; font-weight:700; font-size:0.65rem; margin-bottom:0.2rem; display:inline-block;">🚗 ŞOFÖR</span><br>' : ''}
            <span style="font-size:0.75rem; color:#cbd5e1; font-family:'Fira Code', monospace;">ID: <b>${loginId}</b></span><br>
            <span style="font-size:0.75rem; color:#34d399; font-family:'Fira Code', monospace;">Şifre: <b>${loginPass}</b></span>
          </td>
          <td><span class="badge-tag badge-success">${e.status === 'boarded' ? 'Serviste' : 'Bekliyor'}</span></td>
        </tr>
      `;
    }).join('');
  } else {
    tbody.innerHTML = employees.map(e => {
      const loginId = e.login_id || ('PRS-' + (1000 + e.id));
      const loginPass = e.login_pass || '123456';
      const isDriver = e.role === 'driver';

      return `
        <tr>
          <td><b style="color:#fff;">${e.full_name}</b></td>
          <td>${e.department || 'Genel'}</td>
          <td>${e.phone || '-'}</td>
          <td><span class="badge-tag badge-portal">${e.shuttle_plate || 'Atanmadı'}</span></td>
          <td>${e.stop_name || 'Durak Belirlenmedi'}</td>
          <td>
            ${isDriver ? '<span class="badge-tag" style="background:rgba(16,185,129,0.2); color:#34d399; font-weight:700; font-size:0.65rem; margin-bottom:0.2rem; display:inline-block;">🚗 ŞOFÖR</span><br>' : ''}
            <span style="font-size:0.75rem; color:#cbd5e1; font-family:'Fira Code', monospace;">ID: <b>${loginId}</b></span><br>
            <span style="font-size:0.75rem; color:#34d399; font-family:'Fira Code', monospace;">Şifre: <b>${loginPass}</b></span>
          </td>
          <td><span class="badge-tag badge-success">${e.status === 'boarded' ? 'Serviste' : 'Aktif'}</span></td>
        </tr>
      `;
    }).join('');
  }
}

function handleEmpRoleChange(role) {
  const loginInput = document.getElementById('empInputLoginId');
  if (role === 'driver') {
    if (!loginInput.value || loginInput.value.startsWith('PRS-')) {
      loginInput.value = 'SOFOR-' + Math.floor(100 + Math.random() * 900);
    }
  } else {
    if (!loginInput.value || loginInput.value.startsWith('SOFOR-')) {
      loginInput.value = 'PRS-' + Math.floor(1000 + Math.random() * 9000);
    }
  }
}

// Personel veya Öğrenci/Veli Kaydetme
async function handleCreateEmployeeSubmit(e) {
  e.preventDefault();
  const isSchool = state.activeCompanyData && state.activeCompanyData.company.operation_type === 'school';
  const shuttleId = parseInt(document.getElementById('empInputShuttleSelect').value) || null;
  const role = document.getElementById('empInputRole').value;
  const loginId = document.getElementById('empInputLoginId').value.trim();
  const loginPass = document.getElementById('empInputLoginPass').value.trim() || '123456';

  const payload = {
    full_name: document.getElementById('empInputFullName').value.trim(),
    passenger_type: isSchool ? 'student' : 'employee',
    shuttle_id: shuttleId,
    role: role,
    login_id: loginId || undefined,
    login_pass: loginPass,
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
    showToast("Kayıt Eklendi", `${payload.full_name} (${role === 'driver' ? '🚗 Şoför' : 'Yolcu'}) sisteme kaydedildi. Giriş ID: ${data.employee.login_id}`, "success");
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

// =========================================================================
// 10. SEFER GEÇMİŞİ VE GÜNLÜK RAPORLAMA (YILLIK ARŞİV)
// =========================================================================
state.tripFilterRange = 'today';
state.tripFilterDate = new Date().toISOString().split('T')[0];

window.setTripTimeRange = function(range) {
  state.tripFilterRange = range;
  ['btnTripRangeToday', 'btnTripRangeWeek', 'btnTripRangeMonth', 'btnTripRangeYear'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.className = 'btn-action secondary';
  });
  const activeBtn = document.getElementById(
    range === 'today' ? 'btnTripRangeToday' :
    (range === 'week' ? 'btnTripRangeWeek' :
    (range === 'month' ? 'btnTripRangeMonth' : 'btnTripRangeYear'))
  );
  if (activeBtn) activeBtn.className = 'btn-action primary';

  const dateInput = document.getElementById('filterTripDateInput');
  if (range === 'today') {
    state.tripFilterDate = new Date().toISOString().split('T')[0];
    if (dateInput) dateInput.value = state.tripFilterDate;
  } else {
    state.tripFilterDate = '';
    if (dateInput) dateInput.value = '';
  }
  loadCompanyTrips();
};

window.onTripDateChange = function(val) {
  state.tripFilterDate = val;
  state.tripFilterRange = 'custom';
  ['btnTripRangeToday', 'btnTripRangeWeek', 'btnTripRangeMonth', 'btnTripRangeYear'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.className = 'btn-action secondary';
  });
  loadCompanyTrips();
};

window.loadCompanyTrips = async function() {
  if (!state.activeCompanyId) return;
  const compId = state.activeCompanyId;
  const shuttleId = document.getElementById('filterTripShuttleSelect')?.value || 'all';
  const tripType = document.getElementById('filterTripTypeSelect')?.value || 'all';

  let url = `/api/company/${compId}/trips?shuttleId=${shuttleId}&tripType=${tripType}`;
  if (state.tripFilterDate) {
    url += `&date=${state.tripFilterDate}`;
  } else if (state.tripFilterRange) {
    url += `&range=${state.tripFilterRange}`;
  }

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!data.success) return;

    state.loadedTrips = data.trips || [];
    renderTripStats(data.stats);
    renderTripTable(data.trips);
    populateTripShuttleFilter();
    
    // Durak ortalama giriş saatleri analizini de eşzamanlı yükle
    loadStopAverages();
  } catch (err) {
    console.error('Sefer geçmişi yükleme hatası:', err);
  }
};

// Firma Sahipleri & İK İçin: Günde Ortalama Hangi Durağa Kaçta Giriliyor Tablosu
window.loadStopAverages = async function() {
  if (!state.activeCompanyId) return;
  const compId = state.activeCompanyId;
  const shuttleId = document.getElementById('filterTripShuttleSelect')?.value || 'all';
  const tripType = document.getElementById('filterTripTypeSelect')?.value || 'all';

  const tbody = document.getElementById('companyStopAveragesTableBody');
  if (!tbody) return;

  try {
    const res = await fetch(`/api/company/${compId}/stop-averages?shuttleId=${shuttleId}&tripType=${tripType}`);
    const data = await res.json();
    if (!data.success || !data.averages || data.averages.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 1.75rem; color: var(--text-muted);">
            Henüz durak giriş logu bulunmuyor. Şoförler canlı GPS ile duraklardan geçtikçe ortalama saatler burada otomatik hesaplanır.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = data.averages.map((avg, idx) => {
      const isEvening = avg.trip_type === 'evening';
      const typeBadge = isEvening
        ? '<span class="badge-tag" style="background: rgba(14,165,233,0.15); color: #38bdf8;">🌇 Akşam Dağıtım</span>'
        : '<span class="badge-tag" style="background: rgba(245,158,11,0.15); color: #fbbf24;">🌅 Sabah Toplama</span>';

      const delayMins = avg.avg_delay_minutes || 0;
      let delayBadge = '';
      if (delayMins > 2) {
        delayBadge = `<span class="badge-tag" style="background: rgba(244,63,94,0.15); color: #fb7185; font-weight:700;">⚠️ +${delayMins} dk Gecikmeli</span>`;
      } else if (delayMins < -2) {
        delayBadge = `<span class="badge-tag" style="background: rgba(59,130,246,0.15); color: #60a5fa; font-weight:700;">⚡ ${Math.abs(delayMins)} dk Erken</span>`;
      } else {
        delayBadge = `<span class="badge-tag badge-success">✓ Tam Zamanında (±1 dk)</span>`;
      }

      return `
        <tr>
          <td>${typeBadge}</td>
          <td><b>${avg.stop_order || (idx + 1)}. Durak</b></td>
          <td><b style="color:#fff;">📍 ${avg.stop_name}</b></td>
          <td><span style="font-family:'Fira Code', monospace; color:#94a3b8;">${avg.planned_eta || '-'}</span></td>
          <td>
            <div style="display:flex; align-items:center; gap:0.4rem;">
              <span style="font-size:1.1rem;">⏱️</span>
              <span style="font-family:'Fira Code', monospace; font-size:1rem; font-weight:800; color:#34d399;">${avg.avg_arrival_time}</span>
            </div>
          </td>
          <td>${delayBadge}</td>
          <td><span style="font-size:0.75rem; color:#cbd5e1;">${avg.sample_count} Sefer Verisi</span></td>
          <td><span style="font-size:0.75rem; color:#94a3b8;">${avg.last_date_formatted || '-'}</span></td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Durak analiz yükleme hatası:', err);
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#f43f5e;">Veri yüklenemedi.</td></tr>`;
  }
};

// Seferin her durağa kaçta girdiğini gösteren modalı aç
window.showTripStopLogsModal = function(tripId) {
  const trip = (state.loadedTrips || []).find(t => t.id === tripId);
  if (!trip) return;

  const modal = document.getElementById('modalTripStopDetails');
  const metaEl = document.getElementById('txtModalTripMeta');
  const tbody = document.getElementById('tbodyTripStopLogs');

  const isEvening = trip.trip_type === 'evening';
  const tripTypeLabel = isEvening ? '🌇 Akşam Dağıtım Seferi' : '🌅 Sabah Toplama Seferi';

  metaEl.innerHTML = `
    <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:0.5rem;">
      <div><b>🚐 Plaka:</b> ${trip.plate} &nbsp;|&nbsp; <b>Şoför:</b> ${trip.driver_name || '-'} &nbsp;|&nbsp; <b>Tür:</b> ${tripTypeLabel}</div>
      <div><b>📅 Tarih:</b> ${trip.date_formatted || trip.trip_date} &nbsp;|&nbsp; <b>Kalkış:</b> ${trip.start_time_formatted} ➔ <b>Varış:</b> ${trip.end_time_formatted || 'Sürüyor'}</div>
    </div>
  `;

  const logs = trip.stop_logs || [];
  if (logs.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; padding: 2rem; color: var(--text-muted);">
          Bu sefer için henüz durak geçiş kaydı oluşmamış veya eski tarihli sefer.
        </td>
      </tr>
    `;
  } else {
    tbody.innerHTML = logs.map(l => {
      const delay = l.delay_minutes || 0;
      let delayBadge = '';
      if (delay > 2) {
        delayBadge = `<span class="badge-tag" style="background: rgba(244,63,94,0.15); color: #fb7185;">+${delay} dk gecikmeli</span>`;
      } else if (delay < -2) {
        delayBadge = `<span class="badge-tag" style="background: rgba(59,130,246,0.15); color: #60a5fa;">${Math.abs(delay)} dk erken</span>`;
      } else {
        delayBadge = `<span class="badge-tag badge-success">✓ Zamanında</span>`;
      }

      return `
        <tr>
          <td><b>${l.stop_order}. Durak</b></td>
          <td><b style="color:#fff;">${l.stop_name}</b></td>
          <td><span style="font-family:'Fira Code', monospace; color:#94a3b8;">${l.planned_eta || '-'}</span></td>
          <td><span style="font-family:'Fira Code', monospace; color:#34d399; font-weight:700;">${l.reached_time_formatted || '-'}</span></td>
          <td>${delayBadge}</td>
        </tr>
      `;
    }).join('');
  }

  modal.classList.add('active');
};

function renderTripStats(stats) {
  const totalEl = document.getElementById('statTotalTrips');
  const compSubEl = document.getElementById('statCompletedSubText');
  const avgEl = document.getElementById('statAvgDuration');
  const passEl = document.getElementById('statTotalPassengers');
  const todayEl = document.getElementById('statTodayTrips');
  const activeSubEl = document.getElementById('statActiveTripsSubText');
  const badgeEl = document.getElementById('badgeTripTodayCount');

  if (totalEl) totalEl.innerText = stats.total_count || 0;
  if (compSubEl) compSubEl.innerText = `${stats.completed_count || 0} Tamamlandı`;
  if (avgEl) {
    const mins = stats.avg_duration_mins || 0;
    if (mins >= 60) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      avgEl.innerText = `${h} sa ${m > 0 ? m + ' dk' : ''}`;
    } else {
      avgEl.innerText = `${mins} dk`;
    }
  }
  if (passEl) passEl.innerText = stats.total_passengers || 0;
  if (todayEl) todayEl.innerText = stats.completed_count || 0;
  if (activeSubEl) activeSubEl.innerText = `${stats.active_count || 0} Aktif Sefer`;
  if (badgeEl) badgeEl.innerText = stats.completed_count || 0;
}

function renderTripTable(trips) {
  const tbody = document.getElementById('companyTripsTableBody');
  if (!tbody) return;

  if (!trips || trips.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="11" style="text-align: center; padding: 2.5rem; color: var(--text-muted);">
          <div style="font-size: 2rem; margin-bottom: 0.5rem;">📋</div>
          <b>Seçilen filtre kriterlerine uygun sefer kaydı bulunamadı.</b>
          <div style="font-size: 0.8rem; margin-top: 0.25rem;">Şoförler seferi tamamladıkça kalkış, varış ve süre bilgileri anında burada arşivlenir.</div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = trips.map(t => {
    const isEvening = t.trip_type === 'evening';
    const isCompleted = t.status === 'completed';
    const statusBadge = isCompleted 
      ? '<span class="badge-tag badge-success">✅ Tamamlandı</span>'
      : '<span class="badge-tag" style="background: rgba(16,185,129,0.2); color:#34d399; font-weight:700;">🟢 Sefer Sürüyor</span>';
    
    const typeBadge = isEvening
      ? '<span class="badge-tag" style="background: rgba(14,165,233,0.15); color: #38bdf8; border: 1px solid rgba(14,165,233,0.3);">🌇 Akşam Dağıtım</span>'
      : '<span class="badge-tag" style="background: rgba(245,158,11,0.15); color: #fbbf24; border: 1px solid rgba(245,158,11,0.3);">🌅 Sabah Toplama</span>';

    const durMins = t.duration_minutes || 0;
    let durText = '--';
    if (isCompleted) {
      if (durMins >= 60) {
        const h = Math.floor(durMins / 60);
        const m = durMins % 60;
        durText = `<b>${h} sa ${m > 0 ? m + ' dk' : ''}</b>`;
      } else {
        durText = `<b>${durMins} dk</b>`;
      }
    } else {
      durText = '<span style="color:#34d399; font-size:0.75rem;">⏱️ Devam ediyor...</span>';
    }

    const logCount = (t.stop_logs || []).length;
    const logBtn = `
      <button type="button" class="btn-action secondary" onclick="showTripStopLogsModal(${t.id})" style="padding: 0.25rem 0.6rem; font-size: 0.725rem; white-space:nowrap;">
        ⏱️ Durak Logları (${logCount})
      </button>
    `;

    return `
      <tr>
        <td><b>${t.date_formatted || t.trip_date}</b></td>
        <td>
          <div style="font-family:'Fira Code', monospace; font-weight:800; color:#fff;">${t.plate}</div>
        </td>
        <td>${t.driver_name || '-'}</td>
        <td>${typeBadge}</td>
        <td><span style="font-size:0.8rem; color:#93c5fd;">${t.route_name || 'Servis Güzergahı'}</span></td>
        <td><span style="font-family:'Fira Code', monospace; color:#34d399;">${t.start_time_formatted || '-'}</span></td>
        <td><span style="font-family:'Fira Code', monospace; color:#60a5fa;">${t.end_time_formatted || '--:--:--'}</span></td>
        <td>${durText}</td>
        <td><span class="badge-tag badge-portal">${t.stops_visited || 0} / ${t.total_stops || 0} Durak</span></td>
        <td>${logBtn}</td>
        <td>${statusBadge}</td>
      </tr>
    `;
  }).join('');
}

function populateTripShuttleFilter() {
  const sel = document.getElementById('filterTripShuttleSelect');
  if (!sel || !state.activeCompanyData || sel.options.length > 1) return;
  const shuttles = state.activeCompanyData.shuttles || [];
  shuttles.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.innerText = `🚐 ${s.plate} (${s.driver_name || 'Şoför'})`;
    sel.appendChild(opt);
  });
}

window.exportTripsCsv = function() {
  const table = document.querySelector('#viewCompanyTrips table');
  if (!table) return;
  let csv = [];
  const rows = table.querySelectorAll('tr');
  rows.forEach(r => {
    const cols = r.querySelectorAll('th, td');
    let rowData = [];
    cols.forEach(c => {
      let text = c.innerText.replace(/"/g, '""').replace(/\n/g, ' ').trim();
      rowData.push(`"${text}"`);
    });
    if (rowData.length > 0) csv.push(rowData.join(','));
  });

  const blob = new Blob(["\uFEFF" + csv.join("\n")], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Servis_Sefer_Raporu_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast("Rapor İndirildi", "Sefer kayıtları CSV / Excel formatında dışa aktarıldı.", "success");
};

// Şirket Paneli Açıkken Vercel Arka Plan Sefer Saati Tetikleyicisi (Her 20 saniyede bir kontrol)
setInterval(() => {
  fetch('/api/cron/check-shifts').catch(() => {});
}, 20000);
