const carteClassique = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxZoom: 20 });
const carteSatellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 });
const carteSombre = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 20 });
const carteTopo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17 });

const map = L.map('map', { zoomControl: false, layers: [carteClassique] }).setView([48.0817, 7.3556], 13);
setTimeout(function() { map.invalidateSize(); }, 500); window.addEventListener('resize', function() { map.invalidateSize(); });

let currentStyle = 'classique'; let userGPSMarker = null; let currentTool = null; let tempLatLng = null; let markerEnCoursEdition = null; let pointMesure1 = null; let ligneMesure = null; let gpsLocked = false; 

let callsign = localStorage.getItem('urbex_callsign'); 
let userHeading = 0; 
let squadMarkers = {}; 

let traceGPS = []; const savedTrace = localStorage.getItem('urbex_gps_trace'); if (savedTrace) { traceGPS = JSON.parse(savedTrace); }
let polylineGPS = L.polyline(traceGPS, {color: '#3498db', dashArray: '8, 8', weight: 4}).addTo(map);
let lockedTargetId = null; let targetLaser = L.polyline([], {color: '#e74c3c', dashArray: '10, 10', weight: 3, className: 'target-laser'}).addTo(map);

const marqueursSurCarte = {}; const socket = io(); let currentPhotoBase64 = null;

// --- 🛠️ NOUVEAU SYSTÈME DE POP-UP ANTI-BLOCAGE ---
let sysCallback = null;
function showSysModal(type, title, desc, color, callback) {
    document.getElementById('sys-modal-title').innerText = title;
    document.getElementById('sys-modal-title').style.color = color;
    document.getElementById('sys-modal-desc').innerText = desc;
    document.getElementById('sys-modal-confirm').style.background = color;
    document.querySelector('#system-modal .modal-content').style.borderColor = color;
    
    const input = document.getElementById('sys-modal-input');
    const cancel = document.getElementById('sys-modal-cancel');
    
    input.style.display = (type === 'prompt') ? 'block' : 'none';
    cancel.style.display = (type === 'alert') ? 'none' : 'block';
    input.value = '';
    
    sysCallback = callback;
    document.getElementById('system-modal').style.display = 'flex';
    if(type === 'prompt') setTimeout(() => input.focus(), 100);
}

document.getElementById('sys-modal-cancel').addEventListener('click', () => { document.getElementById('system-modal').style.display = 'none'; if(sysCallback) sysCallback(null); });
document.getElementById('sys-modal-confirm').addEventListener('click', () => { document.getElementById('system-modal').style.display = 'none'; const input = document.getElementById('sys-modal-input'); if(sysCallback) sysCallback(input.style.display === 'block' ? input.value.trim() : true); });

// --- 🎙️ RECONNAISSANCE VOCALE ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = SpeechRecognition ? new SpeechRecognition() : null;
let isDictating = false;

if(recognition) {
    recognition.lang = 'fr-FR'; recognition.interimResults = false; recognition.maxAlternatives = 1;
    recognition.onresult = function(event) {
        document.getElementById('radio-input').value = event.results[0][0].transcript;
        stopDictationUI(); afficherNotification("🎤 Message capté ! Appuie sur GO.", "#2ecc71");
    };
    recognition.onerror = function(event) { stopDictationUI(); if(event.error !== 'aborted') afficherNotification("❌ Erreur micro", "#e74c3c"); };
    recognition.onend = function() { stopDictationUI(); };
}
function stopDictationUI() { isDictating = false; const btn = document.getElementById('btn-dictate'); if(btn) btn.classList.remove('mic-active'); }
function startDictation() {
    if(!recognition) { afficherNotification("❌ Dictée vocale non supportée.", "#e74c3c"); return; }
    if(isDictating) { recognition.stop(); stopDictationUI(); afficherNotification("🔇 Micro coupé", "#95a5a6"); return; }
    document.getElementById('btn-dictate').classList.add('mic-active');
    try { recognition.start(); isDictating = true; afficherNotification("🎙️ Je t'écoute...", "#f39c12"); } catch(e) { recognition.stop(); stopDictationUI(); }
}

// --- 🧭 BOUSSOLE ---
function initCompass() {
    const handleOrientation = (e) => {
        let heading = e.webkitCompassHeading || Math.abs(e.alpha - 360);
        userHeading = heading;
        if (userGPSMarker) { const cone = userGPSMarker.getElement().querySelector('.gps-direction-cone'); if (cone) cone.style.transform = `rotate(${heading}deg)`; }
        if (gpsLocked && userGPSMarker) { socket.emit('player_move', { lat: userGPSMarker.getLatLng().lat, lng: userGPSMarker.getLatLng().lng, name: callsign, heading: heading }); }
    };
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') { DeviceOrientationEvent.requestPermission().then(permissionState => { if (permissionState === 'granted') { window.addEventListener('deviceorientation', handleOrientation); } }).catch(console.error); } 
    else { window.addEventListener('deviceorientation', handleOrientation); }
}

// --- 📡 SQUAD RADAR ---
socket.on('squad_update', (players) => {
    if(panicModeActif) return;
    Object.keys(squadMarkers).forEach(id => { if (!players[id] || id === socket.id) { map.removeLayer(squadMarkers[id]); delete squadMarkers[id]; } });
    Object.keys(players).forEach(id => {
        if (id === socket.id) return; 
        const p = players[id];
        if (squadMarkers[id]) { squadMarkers[id].setLatLng([p.lat, p.lng]); const cone = squadMarkers[id].getElement().querySelector('.gps-direction-cone'); if (cone && p.heading) cone.style.transform = `rotate(${p.heading}deg)`; } 
        else { const htmlIcon = `<div class="gps-pulse-container" style="position:relative;"><div class="teammate-label">${p.name}</div><div class="gps-direction-cone teammate-cone" style="transform: rotate(${p.heading||0}deg);"></div><div class="teammate-pulse-ring"></div><div class="teammate-pulse-dot"></div></div>`; const icon = L.divIcon({ className: 'squad-pulse-wrapper', html: htmlIcon, iconSize: [40, 40], iconAnchor: [20, 20] }); squadMarkers[id] = L.marker([p.lat, p.lng], {icon: icon, zIndexOffset: 999}).addTo(map); }
    });
});

document.getElementById('point-photo').addEventListener('change', function(e) { const file = e.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = function(event) { const img = new Image(); img.onload = function() { const canvas = document.createElement('canvas'); const MAX_WIDTH = 600; let width = img.width; let height = img.height; if (width > MAX_WIDTH) { height = Math.round((height * MAX_WIDTH) / width); width = MAX_WIDTH; } canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, width, height); currentPhotoBase64 = canvas.toDataURL('image/jpeg', 0.7); const preview = document.getElementById('photo-preview'); preview.src = currentPhotoBase64; preview.style.display = 'block'; afficherNotification("📸 Photo attachée !", "#2ecc71"); }; img.src = event.target.result; }; reader.readAsDataURL(file); });

function openIntelReport() { hideAllPanels(); const date = new Date(); const lp = 2551443; const now = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 20, 35, 0); const new_moon = new Date(1970, 0, 7, 20, 35, 0); const phase = ((now.getTime() - new_moon.getTime()) / 1000) % lp; const days = Math.floor(phase / (24 * 3600)); let icon = "🌑"; let name = "Nouvelle Lune"; let advice = "Furtivité maximale."; if (days > 1 && days <= 6) { icon = "🌒"; name = "Premier Croissant"; advice = "Légère luminosité."; } else if (days > 6 && days <= 10) { icon = "🌓"; name = "Premier Quartier"; advice = "Restez dans les ombres."; } else if (days > 10 && days <= 14) { icon = "🌔"; name = "Lune Gibbeuse"; advice = "Forte visibilité."; } else if (days === 14 || days === 15) { icon = "🌕"; name = "Pleine Lune"; advice = "DANGER : Visibilité max."; } else if (days > 15 && days <= 19) { icon = "🌖"; name = "Gibbeuse Décroissante"; advice = "Forte visibilité."; } else if (days > 19 && days <= 23) { icon = "🌗"; name = "Dernier Quartier"; advice = "Luminosité moyenne."; } else if (days > 23 && days <= 28) { icon = "🌘"; name = "Dernier Croissant"; advice = "Excellente couverture."; } document.getElementById('moon-icon').innerText = icon; document.getElementById('moon-phase-name').innerText = name; document.getElementById('moon-tactical-advice').innerText = advice; document.getElementById('intel-modal').style.display = 'flex'; }
window.toggleTargetLock = function(id) { if (lockedTargetId === id) { lockedTargetId = null; targetLaser.setLatLngs([]); document.getElementById('hud-target-row').classList.add('hidden'); afficherNotification("🔓 Cible désengagée", "#95a5a6"); } else { lockedTargetId = id; afficherNotification("🎯 Cible verrouillée !", "#e74c3c"); updateTargetLaser(); } map.closePopup(); };
function updateTargetLaser() { if (!lockedTargetId || !userGPSMarker || !marqueursSurCarte[lockedTargetId]) { targetLaser.setLatLngs([]); document.getElementById('hud-target-row').classList.add('hidden'); return; } const targetData = marqueursSurCarte[lockedTargetId].marker.donnees; const userLat = userGPSMarker.getLatLng().lat; const userLng = userGPSMarker.getLatLng().lng; targetLaser.setLatLngs([[userLat, userLng], [targetData.lat, targetData.lng]]); const y = Math.sin((targetData.lng - userLng) * Math.PI / 180) * Math.cos(targetData.lat * Math.PI / 180); const x = Math.cos(userLat * Math.PI / 180) * Math.sin(targetData.lat * Math.PI / 180) - Math.sin(userLat * Math.PI / 180) * Math.cos(targetData.lat * Math.PI / 180) * Math.cos((targetData.lng - userLng) * Math.PI / 180); const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; document.getElementById('hud-target-row').classList.remove('hidden'); document.getElementById('hud-bearing').innerText = `${Math.round(bearing)}°`; }
function toggleRedMode() { hideAllPanels(); document.body.classList.toggle('red-mode'); const btn = document.getElementById('btn-red-toggle'); if (document.body.classList.contains('red-mode')) { afficherNotification("🔴 Infrarouge Activé", "#e74c3c"); btn.innerHTML = "🟢 Désactiver Infrarouge"; btn.style.color = "#2ecc71"; btn.style.borderColor = "#2ecc71"; } else { afficherNotification("🟢 Infrarouge Désactivé", "#2ecc71"); btn.innerHTML = "🔴 Infrarouge"; btn.style.color = "#e74c3c"; btn.style.borderColor = "#e74c3c"; } }

// ⏱️ CHRONO MODIFIÉ
let timerInterval; let timeRemaining = 0; 
function startTimerPrompt() { 
    hideAllPanels(); 
    showSysModal('prompt', '⏱️ CHRONO EXTRACTION', 'Temps avant extraction (en min) :\n(Mets 0 pour annuler)', '#f39c12', (mins) => {
        if (mins && !isNaN(mins) && parseInt(mins) > 0) { timeRemaining = parseInt(mins) * 60; const timerEl = document.getElementById('extraction-timer'); timerEl.classList.remove('hidden'); timerEl.style.background = "#f39c12"; timerEl.style.color = "#fff"; clearInterval(timerInterval); timerInterval = setInterval(updateTimer, 1000); updateTimer(); afficherNotification(`⏱️ Chrono lancé !`, "#f39c12"); } 
        else if (mins === "0") { clearInterval(timerInterval); document.getElementById('extraction-timer').classList.add('hidden'); afficherNotification("⏱️ Annulé", "#95a5a6"); }
    });
} 
function updateTimer() { const timerEl = document.getElementById('extraction-timer'); if (timeRemaining <= 0) { clearInterval(timerInterval); timerEl.innerText = "⚠️ GO !"; timerEl.style.background = "#e74c3c"; if ("vibrate" in navigator) navigator.vibrate([1000, 500, 1000, 500, 1000]); afficherNotification("⚠️ EXTRACTION !", "#e74c3c"); return; } timeRemaining--; const m = Math.floor(timeRemaining / 60).toString().padStart(2, '0'); const s = (timeRemaining % 60).toString().padStart(2, '0'); timerEl.innerText = `⏱️ ${m}:${s}`; if (timeRemaining === 300) { timerEl.style.background = "#e74c3c"; afficherNotification("⚠️ 5 min restantes !", "#e74c3c"); if ("vibrate" in navigator) navigator.vibrate([500, 200, 500]); } }

let panicModeActif = false; function triggerPanic() { panicModeActif = true; localStorage.setItem('panicModeUrbex', 'actif'); hideAllPanels(); document.querySelector('.top-bar').style.display = 'none'; document.querySelector('.side-tools').style.display = 'none'; document.querySelector('.bottom-dock').style.display = 'none'; document.getElementById('fake-ui').style.display = 'block'; document.body.classList.remove('red-mode'); setMapStyle('classique'); Object.values(marqueursSurCarte).forEach(m => { map.removeLayer(m.marker); if (m.cercle) map.removeLayer(m.cercle); }); map.removeLayer(polylineGPS); targetLaser.setLatLngs([]); Object.values(squadMarkers).forEach(m => map.removeLayer(m)); } function disablePanic() { panicModeActif = false; localStorage.removeItem('panicModeUrbex'); document.querySelector('.top-bar').style.display = 'flex'; document.querySelector('.side-tools').style.display = 'flex'; document.querySelector('.bottom-dock').style.display = 'flex'; document.getElementById('fake-ui').style.display = 'none'; rafraichirFiltresRadar(); map.addLayer(polylineGPS); afficherNotification("👁️ Urbex Restauré", "#8e44ad"); updateTargetLaser(); Object.values(squadMarkers).forEach(m => m.addTo(map)); } if (localStorage.getItem('panicModeUrbex') === 'actif') { triggerPanic(); }
socket.on('disconnect', () => { document.getElementById('offline-banner').classList.remove('hidden'); }); socket.on('connect', () => { document.getElementById('offline-banner').classList.add('hidden'); });
function hideAllPanels() { document.getElementById('layers-menu').classList.add('hidden'); document.getElementById('radio-panel').classList.add('hidden'); } function toggleLayersMenu() { const menu = document.getElementById('layers-menu'); const isHidden = menu.classList.contains('hidden'); hideAllPanels(); if (isHidden) menu.classList.remove('hidden'); } function toggleRadio() { const panel = document.getElementById('radio-panel'); const isHidden = panel.classList.contains('hidden'); hideAllPanels(); if (isHidden) panel.classList.remove('hidden'); } function toggleRadar() { document.getElementById('radar-content').classList.toggle('hidden'); }

// 🚨 SIGNALEMENT SÉCURITÉ MODIFIÉ
map.on('click', function(e) { 
    hideAllPanels(); document.getElementById('radar-content').classList.add('hidden'); 
    if (currentTool === 'patrol') { 
        showSysModal('prompt', '🚨 SÉCURITÉ', 'Quel type de patrouille ? (Vigile, Chien...)', '#e74c3c', (desc) => {
            if(desc) { 
                const newData = { lat: e.latlng.lat, lng: e.latlng.lng, nom: "🚨 " + desc, date: new Date().toLocaleDateString('fr-FR'), statut: "patrol", personnes: ["Signal Rapide"], notes: "Sécurité." }; 
                fetch('/api/markers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newData) }); 
                toggleTool('patrol'); 
            }
        });
    } 
});

function setMapStyle(styleRequested) { map.removeLayer(carteClassique); map.removeLayer(carteSatellite); map.removeLayer(carteSombre); map.removeLayer(carteTopo); document.body.classList.remove('dark-mode'); if (styleRequested === 'satellite') { map.addLayer(carteSatellite); if(!panicModeActif) afficherNotification("🛰️ Satellite", "#27ae60"); } else if (styleRequested === 'topo') { map.addLayer(carteTopo); if(!panicModeActif) afficherNotification("⛰️ Topo", "#8e44ad"); } else if (styleRequested === 'nuit') { map.addLayer(carteSombre); document.body.classList.add('dark-mode'); if(!panicModeActif) afficherNotification("🦇 Vision Nuit", "#c0392b"); } else { map.addLayer(carteClassique); if(!panicModeActif) afficherNotification("🗺️ Classique", "#3498db"); } currentStyle = styleRequested; hideAllPanels(); }
function toggleStealth() { document.getElementById('stealth-screen').style.display = 'block'; if ("vibrate" in navigator) navigator.vibrate(100); } document.getElementById('stealth-screen').addEventListener('dblclick', () => { document.getElementById('stealth-screen').style.display = 'none'; });

// 🕵️ GPS MODIFIÉ
function localiserMoi() {
    if (!callsign) { 
        showSysModal('prompt', '🕵️ IDENTIFICATION', 'Identifiant Agent (Pseudo) :', '#3498db', (val) => {
            if(val) { callsign = val; localStorage.setItem('urbex_callsign', callsign); executeLocaliserMoi(); }
        });
    } else {
        executeLocaliserMoi();
    }
}

function executeLocaliserMoi() {
    hideAllPanels(); const gpsBtn = document.getElementById('btn-gps-dock'); gpsLocked = !gpsLocked; const hud = document.getElementById('tactical-hud');
    if (gpsLocked) { initCompass(); afficherNotification("🔒 GPS : Suivi & HUD", "#2ecc71"); gpsBtn.classList.add('locked'); hud.classList.remove('hidden'); map.locate({setView: true, maxZoom: 18, watch: true, enableHighAccuracy: true}); } 
    else { afficherNotification("🔓 GPS Déverrouillé", "#95a5a6"); gpsBtn.classList.remove('locked'); hud.classList.add('hidden'); map.stopLocate(); }
}

map.on('locationerror', function(e) { afficherNotification("❌ Erreur GPS : " + e.message, "#e74c3c"); if(gpsLocked) executeLocaliserMoi(); });
map.on('locationfound', function(e) {
    if (!userGPSMarker) { const htmlIcon = `<div class="gps-pulse-container"><div class="gps-direction-cone" style="transform: rotate(${userHeading}deg);"></div><div class="gps-pulse-ring"></div><div class="gps-pulse-dot"></div></div>`; const radarIcon = L.divIcon({ className: 'gps-pulse-wrapper', html: htmlIcon, iconSize: [40, 40], iconAnchor: [20, 20] }); userGPSMarker = L.marker(e.latlng, {icon: radarIcon, zIndexOffset: 1000}).addTo(map); userGPSMarker.bindPopup("<b>🎯 Tu es ici</b>").openPopup(); } else { userGPSMarker.setLatLng(e.latlng); }
    if (gpsLocked) {
        document.getElementById('hud-coords').innerText = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`; document.getElementById('hud-acc').innerText = `${Math.round(e.accuracy)} m`; let vit = e.speed ? (e.speed * 3.6).toFixed(1) + " km/h" : "0.0 km/h"; document.getElementById('hud-speed').innerText = vit;
        map.setView(e.latlng, map.getZoom(), { animate: true, duration: 0.5 }); traceGPS.push(e.latlng); polylineGPS.setLatLngs(traceGPS); localStorage.setItem('urbex_gps_trace', JSON.stringify(traceGPS)); updateTargetLaser(); socket.emit('player_move', { lat: e.latlng.lat, lng: e.latlng.lng, name: callsign, heading: userHeading });
        if (!panicModeActif) { Object.values(marqueursSurCarte).forEach(markerObj => { const data = markerObj.marker.donnees; if (data.statut === 'garde' || data.statut === 'dangereux' || data.statut === 'patrol') { const dist = map.distance(e.latlng, [data.lat, data.lng]); if (dist < 150 && !markerObj.warned) { afficherNotification(`⚠️ ALERTE : Proche de "${data.nom}" !`, "#e74c3c"); if ("vibrate" in navigator) navigator.vibrate([300, 150, 300, 150, 500]); markerObj.warned = true; } } }); }
    }
});

function sendRadio() { const input = document.getElementById('radio-input'); const txt = input.value.trim(); if(txt) { socket.emit('chat_message', `[${callsign || 'Agent'}] ` + txt); input.value = ''; } }
socket.on('chat_message', (msg) => { if(panicModeActif) return; const time = new Date().toLocaleTimeString('fr-FR', {hour: '2-digit', minute:'2-digit'}); const box = document.getElementById('radio-messages'); const msgDiv = document.createElement('div'); msgDiv.className = 'msg-line'; msgDiv.innerHTML = `<span class="msg-time">[${time}]</span> ${msg}`; box.appendChild(msgDiv); box.scrollTop = box.scrollHeight; if (document.getElementById('radio-panel').classList.contains('hidden')) { afficherNotification("💬 Nouveau message", "#3498db"); } if (document.getElementById('ghost-mode-cb').checked) { setTimeout(() => { msgDiv.classList.add('ghost-out'); setTimeout(() => msgDiv.remove(), 1000); }, 30000); } });

function triggerSOS() { 
    hideAllPanels(); 
    document.getElementById('sos-confirm-modal').style.display = 'flex';
}

window.executeSOS = function() {
    document.getElementById('sos-confirm-modal').style.display = 'none';
    if (userGPSMarker) {
        socket.emit('sos_alert', { lat: userGPSMarker.getLatLng().lat, lng: userGPSMarker.getLatLng().lng }); 
        afficherNotification("🚨 Signal S.O.S envoyé !", "#c0392b");
        return; 
    }
    if (!navigator.geolocation) { afficherNotification("❌ GPS non supporté.", "#e74c3c"); return; }
    afficherNotification("🚨 Acquisition GPS en cours...", "#f39c12");
    navigator.geolocation.getCurrentPosition(
        pos => { socket.emit('sos_alert', { lat: pos.coords.latitude, lng: pos.coords.longitude }); afficherNotification("🚨 Signal S.O.S envoyé !", "#c0392b"); }, 
        err => { afficherNotification("❌ Échec S.O.S : " + err.message, "#c0392b"); }, 
        { enableHighAccuracy: false, timeout: 20000, maximumAge: 10000 } 
    ); 
}

socket.on('sos_alert', (data) => { if(panicModeActif) return; document.getElementById('sos-screen').style.display = 'block'; afficherNotification(`🚨 URGENCE !`, '#c0392b'); if ("vibrate" in navigator) navigator.vibrate([1000, 500, 1000, 500, 1000]); const sosIcon = L.divIcon({ className: 'custom-pin-wrapper', html: `<div class="urbex-pin-container"><div class="urbex-pin bg-dangereux" style="width:40px; height:40px; border-color:yellow;"></div></div>`, iconSize: [50, 70], iconAnchor: [25, 70], popupAnchor: [0, -60] }); L.marker([data.lat, data.lng], {icon: sosIcon, zIndexOffset: 9999}).addTo(map).bindPopup("<b style='color:red; font-size:16px;'>🚨 S.O.S !</b>").openPopup(); map.setView([data.lat, data.lng], 18); setTimeout(() => { document.getElementById('sos-screen').style.display = 'none'; }, 10000); });
map.on('contextmenu', function(e) { if (currentTool === 'add' || currentTool === 'patrol' || panicModeActif) return; socket.emit('ping_tactique', { lat: e.latlng.lat, lng: e.latlng.lng }); afficherNotification("📡 Ping envoyé !", "#3498db"); });
socket.on('ping_tactique', (data) => { if(panicModeActif) return; afficherNotification("📍 Ping d'équipe !", "#2980b9"); const pingIcon = L.divIcon({ className: 'ping-pulse-wrapper', html: '<div class="ping-tactique-ring"></div>', iconSize: [60, 60], iconAnchor: [30, 30] }); const tempPing = L.marker([data.lat, data.lng], {icon: pingIcon, zIndexOffset: 800}).addTo(map); setTimeout(() => { map.removeLayer(tempPing); }, 15000); });
function exportGPX() { let gpxContent = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="MapsForUrbex">\n'; Object.values(marqueursSurCarte).forEach(markerObj => { const data = markerObj.marker.donnees; gpxContent += `  <wpt lat="${data.lat}" lon="${data.lng}">\n    <name>${data.nom}</name>\n    <desc>Statut: ${data.statut}</desc>\n  </wpt>\n`; }); gpxContent += '</gpx>'; const blob = new Blob([gpxContent], { type: 'application/gpx+xml' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'urbex_spots.gpx'; document.body.appendChild(a); a.click(); document.body.removeChild(a); afficherNotification("💾 Export GPX réussi !", "#2ecc71"); }
function afficherNotification(message, couleur) { if(panicModeActif && couleur !== "#8e44ad") return; const toast = document.createElement('div'); toast.innerText = message; toast.style.cssText = `position: fixed; top: 70px; left: 50%; transform: translateX(-50%) translateY(-50px); background: ${couleur}; color: white; padding: 10px 20px; border-radius: 30px; font-weight: bold; box-shadow: 0 4px 15px rgba(0,0,0,0.4); z-index: 4000; transition: all 0.3s ease; opacity: 0; text-align: center; font-size: 13px; pointer-events:none;`; document.body.appendChild(toast); setTimeout(() => { toast.style.transform = 'translateX(-50%) translateY(0)'; toast.style.opacity = '1'; }, 10); setTimeout(() => { toast.style.transform = 'translateX(-50%) translateY(-50px)'; toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000); }
function rafraichirFiltresRadar() { if(panicModeActif) return; Object.values(marqueursSurCarte).forEach(markerObj => { const statut = markerObj.marker.donnees.statut || 'accessible'; const estCoche = document.querySelector(`.filter-cb[value="${statut}"]`) ? document.querySelector(`.filter-cb[value="${statut}"]`).checked : true; if (estCoche) { if (!map.hasLayer(markerObj.marker)) map.addLayer(markerObj.marker); if (markerObj.cercle && !map.hasLayer(markerObj.cercle)) map.addLayer(markerObj.cercle); } else { if (map.hasLayer(markerObj.marker)) map.removeLayer(markerObj.marker); if (markerObj.cercle && map.hasLayer(markerObj.cercle)) map.removeLayer(markerObj.cercle); } }); } document.querySelectorAll('.filter-cb').forEach(cb => { cb.addEventListener('change', rafraichirFiltresRadar); });
function rafraichirCacheLocal(points) { localStorage.setItem('urbex_backup_markers', JSON.stringify(points)); }
socket.on('marker_added', (nouveauPoint) => { creerMarqueurSurCarte(nouveauPoint); afficherNotification(`📍 ${nouveauPoint.nom} ajouté`, '#1abc9c'); chargerMarkers(true); }); socket.on('marker_edited', (pointModifie) => { const markerObj = marqueursSurCarte[pointModifie.id]; if (markerObj) { map.removeLayer(markerObj.marker); if (markerObj.cercle) map.removeLayer(markerObj.cercle); delete marqueursSurCarte[pointModifie.id]; creerMarqueurSurCarte(pointModifie); } chargerMarkers(true); if(lockedTargetId === pointModifie.id) updateTargetLaser(); }); socket.on('marker_deleted', (idSupprime) => { const markerObj = marqueursSurCarte[idSupprime]; if (markerObj) { map.removeLayer(markerObj.marker); if (markerObj.cercle) map.removeLayer(markerObj.cercle); delete marqueursSurCarte[idSupprime]; } chargerMarkers(true); if(lockedTargetId === idSupprime) window.toggleTargetLock(idSupprime); });
async function chargerMarkers(isBackgroundUpdate = false) { try { const response = await fetch('/api/markers'); if (!response.ok) throw new Error("Réseau"); const points = await response.json(); rafraichirCacheLocal(points); if (!isBackgroundUpdate) { points.forEach(point => creerMarqueurSurCarte(point)); } } catch (error) { if (!isBackgroundUpdate) { afficherNotification("⚠️ Mode Survie", "#e74c3c"); const backup = localStorage.getItem('urbex_backup_markers'); if (backup) { const points = JSON.parse(backup); points.forEach(point => creerMarqueurSurCarte(point)); } } } } chargerMarkers();
const statusText = document.getElementById('status-text'); function toggleTool(tool) { hideAllPanels(); currentTool = (currentTool === tool) ? null : tool; document.getElementById('btn-add').classList.toggle('active-add', currentTool === 'add'); document.getElementById('btn-edit').classList.toggle('active-edit', currentTool === 'edit'); document.getElementById('btn-del').classList.toggle('active-del', currentTool === 'delete'); document.getElementById('btn-measure').classList.toggle('active-measure', currentTool === 'measure'); document.getElementById('btn-patrol').classList.toggle('active-patrol', currentTool === 'patrol'); if (currentTool !== 'measure') { pointMesure1 = null; if (ligneMesure) map.removeLayer(ligneMesure); } if(currentTool === 'add') statusText.innerText = "📍 Ajout : Clique sur la carte"; else if(currentTool === 'edit') statusText.innerText = "✏️ Modif : Clique sur un spot"; else if(currentTool === 'delete') statusText.innerText = "🗑️ Suppr : Clique sur un spot"; else if(currentTool === 'measure') statusText.innerText = "📏 Mesure : Clique au départ"; else if(currentTool === 'patrol') statusText.innerText = "👮 Patrouille : Clique pour signaler"; else statusText.innerText = "👋 Prêt à explorer"; }
function creerIcone(statut) { let bgClass = 'bg-accessible'; if (statut === 'garde') bgClass = 'bg-garde'; if (statut === 'dangereux') bgClass = 'bg-dangereux'; if (statut === 'detruit') bgClass = 'bg-detruit'; if (statut === 'patrol') bgClass = 'bg-patrol'; if (statut === 'extraction') bgClass = 'bg-extraction'; return L.divIcon({ className: 'custom-pin-wrapper', html: `<div class="urbex-pin-container"><div class="urbex-pin ${bgClass}"></div></div>`, iconSize: [30, 42], iconAnchor: [15, 42], popupAnchor: [0, -40] }); }
function genererPopupHTML(data) { const peopleHtml = data.personnes && data.personnes.length > 0 ? `<div style="font-size:12px; opacity:0.8;">${data.personnes.join(', ')}</div>` : `<div style="font-size:12px; opacity:0.8;">Solo</div>`; let badgeText = "Accessible"; let badgeClass = "badge-accessible"; if (data.statut === 'garde') { badgeText = "Gardé / Caméras"; badgeClass = "badge-garde"; } if (data.statut === 'dangereux') { badgeText = "Dangereux / Ruine"; badgeClass = "badge-dangereux"; } if (data.statut === 'detruit') { badgeText = "Détruit / Muré"; badgeClass = "badge-detruit"; } if (data.statut === 'patrol') { badgeText = "🚨 Sécurité Signalée"; badgeClass = "badge-dangereux"; } if (data.statut === 'extraction') { badgeText = "🚗 Point d'Extraction"; badgeClass = "badge-extraction"; } const photoHtml = data.photo ? `<img src="${data.photo}" class="popup-photo">` : ''; const notesHtml = data.notes && data.notes.trim() !== "" ? `<div style="background: rgba(0,0,0,0.1); padding: 8px; border-radius: 6px; font-size: 11px; margin-top: 8px; font-style: italic; border-left: 3px solid #3498db;">📝 ${data.notes}</div>` : ''; const streetViewBtn = `<button class="btn-streetview" onclick="window.open('https://www.google.com/maps?layer=c&cbll=${data.lat},${data.lng}', '_blank')">👁️ Street View</button>`; const isLocked = lockedTargetId === data.id; const lockBtnClass = isLocked ? 'btn-target-lock locked-active' : 'btn-target-lock'; const lockBtnText = isLocked ? '🔓 Désengager la cible' : '🎯 Verrouiller Cible'; const targetLockBtn = `<button class="${lockBtnClass}" onclick="window.toggleTargetLock('${data.id}')">${lockBtnText}</button>`; return ` <div style="min-width: 180px;"> ${photoHtml} <div class="badge ${badgeClass}" style="display:inline-block; padding:3px 8px; border-radius:10px; font-size:10px; margin-bottom:5px; color:white;">${badgeText}</div> <h3 style="margin: 0 0 5px 0; font-size:15px; border-bottom:1px solid rgba(255,255,255,0.2); padding-bottom:5px;">${data.nom}</h3> <div style="font-size: 12px;">📅 ${data.date || 'Inconnue'}</div> <div style="margin-top:5px; font-size: 12px;">👥 <strong>Équipe :</strong></div>${peopleHtml} ${notesHtml} <div class="dynamic-distance" style="margin-top: 8px; font-size: 12px; color: #3498db; font-weight:bold;">📍 Calcul...</div> ${targetLockBtn} ${streetViewBtn} </div>`; }

// 🗑️ SUPPRESSION MODIFIÉE
function creerMarqueurSurCarte(dataMarqueur) { 
    if (marqueursSurCarte[dataMarqueur.id]) return; const marker = L.marker([dataMarqueur.lat, dataMarqueur.lng], { icon: creerIcone(dataMarqueur.statut || 'accessible') }); if (!panicModeActif) { marker.addTo(map); } marker.donnees = dataMarqueur; marker.bindPopup(genererPopupHTML(dataMarqueur), { className: 'custom-popup', closeButton: false }); marker.on('popupopen', function() { if (userGPSMarker) { const distanceMetres = map.distance(userGPSMarker.getLatLng(), marker.getLatLng()); let textDist = distanceMetres > 1000 ? (distanceMetres/1000).toFixed(2) + " km" : distanceMetres.toFixed(0) + " m"; const distDiv = marker.getPopup().getElement().querySelector('.dynamic-distance'); if (distDiv) distDiv.innerHTML = `🚶 ${textDist} de toi`; } }); let dangerCircle = null; if (dataMarqueur.statut === 'garde' || dataMarqueur.statut === 'dangereux' || dataMarqueur.statut === 'patrol') { const estGarde = dataMarqueur.statut === 'garde'; dangerCircle = L.circle([dataMarqueur.lat, dataMarqueur.lng], { color: estGarde ? '#f39c12' : '#e74c3c', fillColor: estGarde ? '#f39c12' : '#e74c3c', fillOpacity: 0.15, radius: estGarde ? 150 : 100 }); if (!panicModeActif) { dangerCircle.addTo(map); dangerCircle.bringToBack(); } } marqueursSurCarte[dataMarqueur.id] = { marker: marker, cercle: dangerCircle }; 
    marker.on('click', async function() { 
        if (currentTool === 'delete') { 
            marker.closePopup(); 
            showSysModal('confirm', '🗑️ SUPPRESSION', `Es-tu sûr de vouloir effacer "${marker.donnees.nom}" ?`, '#e74c3c', (res) => {
                if (res) fetch(`/api/markers/${marker.donnees.id}`, { method: 'DELETE' }); 
            });
        } 
        else if (currentTool === 'edit') { marker.closePopup(); markerEnCoursEdition = marker; document.getElementById('modal-title').innerText = "Modifier le Spot"; document.getElementById('point-name').value = marker.donnees.nom; document.getElementById('point-date').value = marker.donnees.date === "Inconnue" ? "" : marker.donnees.date; document.getElementById('point-status').value = marker.donnees.statut || 'accessible'; document.getElementById('point-notes').value = marker.donnees.notes || ""; currentPhotoBase64 = marker.donnees.photo || null; const preview = document.getElementById('photo-preview'); if(currentPhotoBase64) { preview.src = currentPhotoBase64; preview.style.display = 'block'; } else { preview.style.display = 'none'; } document.getElementById('point-photo').value = ""; const pList = document.getElementById('people-list'); pList.innerHTML = ''; if (!marker.donnees.personnes || marker.donnees.personnes.length === 0) { pList.innerHTML = '<input type="text" class="person-input" placeholder="Personne 1">'; } else { marker.donnees.personnes.forEach((p, index) => { const input = document.createElement('input'); input.type = 'text'; input.className = 'person-input'; input.placeholder = `Personne ${index + 1}`; input.value = p; pList.appendChild(input); }); } document.getElementById('modal').style.display = 'flex'; } else { map.flyTo([marker.donnees.lat, marker.donnees.lng], 17, { animate: true, duration: 0.6 }); } 
    }); 
}

map.on('click', function(e) { if (currentTool === 'add') { tempLatLng = e.latlng; document.getElementById('modal-title').innerText = "Nouveau Spot"; document.getElementById('modal').style.display = 'flex'; } else if (currentTool === 'measure') { if (!pointMesure1) { pointMesure1 = e.latlng; statusText.innerText = "📏 Clique maintenant sur l'arrivée."; afficherNotification("Point de départ validé.", "#3498db"); } else { const pointMesure2 = e.latlng; const distanceMetres = map.distance(pointMesure1, pointMesure2).toFixed(0); if (ligneMesure) map.removeLayer(ligneMesure); ligneMesure = L.polyline([pointMesure1, pointMesure2], { color: '#e74c3c', dashArray: '8, 8', weight: 3 }).addTo(map); ligneMesure.bindPopup(`<div style="text-align:center;"><strong style="color:#e74c3c; font-size:16px;">${distanceMetres} m</strong></div>`, {className: 'custom-popup', closeOnClick: false}).openPopup(); pointMesure1 = null; statusText.innerText = "📏 Nouveau départ ?"; } } });
document.getElementById('btn-add-person').addEventListener('click', () => { const list = document.getElementById('people-list'); if (list.children.length < 15) { const input = document.createElement('input'); input.type = 'text'; input.className = 'person-input'; input.placeholder = `Personne ${list.children.length + 1}`; list.appendChild(input); } }); document.getElementById('btn-cancel').addEventListener('click', () => { document.getElementById('modal').style.display = 'none'; document.getElementById('point-name').value = ''; document.getElementById('point-notes').value = ''; document.getElementById('point-date').value = ''; document.getElementById('point-status').value = 'accessible'; document.getElementById('people-list').innerHTML = '<input type="text" class="person-input" placeholder="Personne 1">'; currentPhotoBase64 = null; document.getElementById('point-photo').value = ""; document.getElementById('photo-preview').style.display = 'none'; tempLatLng = null; markerEnCoursEdition = null; }); document.getElementById('btn-confirm').addEventListener('click', () => { const name = document.getElementById('point-name').value.trim() || "Spot"; const date = document.getElementById('point-date').value || "Inconnue"; const statut = document.getElementById('point-status').value; const notes = document.getElementById('point-notes').value.trim(); let peopleNames = []; document.querySelectorAll('.person-input').forEach(input => { if (input.value.trim() !== '') peopleNames.push(input.value.trim()); }); if (markerEnCoursEdition) { const updatedData = { nom: name, date: date, statut: statut, personnes: peopleNames, notes: notes, photo: currentPhotoBase64 }; fetch(`/api/markers/${markerEnCoursEdition.donnees.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedData) }); } else { const newData = { lat: tempLatLng.lat, lng: tempLatLng.lng, nom: name, date: date, statut: statut, personnes: peopleNames, notes: notes, photo: currentPhotoBase64 }; fetch('/api/markers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newData) }); } document.getElementById('btn-cancel').click(); });