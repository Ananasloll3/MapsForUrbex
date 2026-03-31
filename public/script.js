const carteClassique = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxZoom: 20 });
const carteSatellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 });
const carteSombre = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 20 });
const carteTopo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17 });

const map = L.map('map', { zoomControl: false, layers: [carteClassique] }).setView([48.0817, 7.3556], 13);
setTimeout(function() { map.invalidateSize(); }, 500);
window.addEventListener('resize', function() { map.invalidateSize(); });

let currentStyle = 'classique'; 
let userGPSMarker = null;
let currentTool = null; let tempLatLng = null; let markerEnCoursEdition = null; 
let pointMesure1 = null; let ligneMesure = null; 
let gpsLocked = false; 

let traceGPS = [];
let polylineGPS = L.polyline([], {color: '#3498db', dashArray: '8, 8', weight: 4}).addTo(map);

const marqueursSurCarte = {};
const socket = io();

// --- 🔴 FILTRE INFRAROUGE ---
function toggleRedMode() {
    hideAllPanels(); document.body.classList.toggle('red-mode'); const btn = document.getElementById('btn-red-toggle');
    if (document.body.classList.contains('red-mode')) { afficherNotification("🔴 Vision Infrarouge Activée", "#e74c3c"); btn.innerHTML = "🟢 Désactiver Infrarouge"; btn.style.color = "#2ecc71"; btn.style.borderColor = "#2ecc71"; } 
    else { afficherNotification("🟢 Vision Infrarouge Désactivée", "#2ecc71"); btn.innerHTML = "🔴 Filtre Infrarouge"; btn.style.color = "#e74c3c"; btn.style.borderColor = "#e74c3c"; }
}

// --- ⏱️ CHRONO D'EXTRACTION ---
let timerInterval; let timeRemaining = 0;
function startTimerPrompt() {
    hideAllPanels(); const mins = prompt("⏱️ Temps avant extraction (en minutes) :\n(Mets 0 pour annuler)");
    if (mins && !isNaN(mins) && parseInt(mins) > 0) {
        timeRemaining = parseInt(mins) * 60; const timerEl = document.getElementById('extraction-timer');
        timerEl.classList.remove('hidden'); timerEl.style.background = "#f39c12"; timerEl.style.color = "#fff";
        clearInterval(timerInterval); timerInterval = setInterval(updateTimer, 1000); updateTimer(); afficherNotification(`⏱️ Chrono lancé pour ${mins} minutes !`, "#f39c12");
    } else if (mins === "0") { clearInterval(timerInterval); document.getElementById('extraction-timer').classList.add('hidden'); afficherNotification("⏱️ Chrono annulé", "#95a5a6"); }
}
function updateTimer() {
    const timerEl = document.getElementById('extraction-timer');
    if (timeRemaining <= 0) { clearInterval(timerInterval); timerEl.innerText = "⚠️ GO !"; timerEl.style.background = "#e74c3c"; if ("vibrate" in navigator) navigator.vibrate([1000, 500, 1000, 500, 1000]); afficherNotification("⚠️ TEMPS D'EXTRACTION ÉCOULÉ !", "#e74c3c"); return; }
    timeRemaining--; const m = Math.floor(timeRemaining / 60).toString().padStart(2, '0'); const s = (timeRemaining % 60).toString().padStart(2, '0'); timerEl.innerText = `⏱️ ${m}:${s}`;
    if (timeRemaining === 300) { timerEl.style.background = "#e74c3c"; afficherNotification("⚠️ Il reste 5 minutes !", "#e74c3c"); if ("vibrate" in navigator) navigator.vibrate([500, 200, 500]); }
}

// --- 🚨 MODE PANIC (AVEC SAUVEGARDE) ---
let panicModeActif = false;
function triggerPanic() {
    panicModeActif = true; localStorage.setItem('panicModeUrbex', 'actif'); 
    hideAllPanels(); document.querySelector('.top-bar').style.display = 'none'; document.querySelector('.side-tools').style.display = 'none'; document.querySelector('.bottom-dock').style.display = 'none'; document.getElementById('fake-ui').style.display = 'block'; document.body.classList.remove('red-mode');
    setMapStyle('classique'); Object.values(marqueursSurCarte).forEach(m => { map.removeLayer(m.marker); if (m.cercle) map.removeLayer(m.cercle); }); map.removeLayer(polylineGPS);
}
function disablePanic() {
    panicModeActif = false; localStorage.removeItem('panicModeUrbex');
    document.querySelector('.top-bar').style.display = 'flex'; document.querySelector('.side-tools').style.display = 'flex'; document.querySelector('.bottom-dock').style.display = 'flex'; document.getElementById('fake-ui').style.display = 'none';
    rafraichirFiltresRadar(); map.addLayer(polylineGPS); afficherNotification("👁️ Mode Urbex Restauré", "#8e44ad");
}
if (localStorage.getItem('panicModeUrbex') === 'actif') { triggerPanic(); }

socket.on('disconnect', () => { document.getElementById('offline-banner').classList.remove('hidden'); });
socket.on('connect', () => { document.getElementById('offline-banner').classList.add('hidden'); });

function hideAllPanels() { document.getElementById('layers-menu').classList.add('hidden'); document.getElementById('radio-panel').classList.add('hidden'); }
function toggleLayersMenu() { const menu = document.getElementById('layers-menu'); const isHidden = menu.classList.contains('hidden'); hideAllPanels(); if (isHidden) menu.classList.remove('hidden'); }
function toggleRadio() { const panel = document.getElementById('radio-panel'); const isHidden = panel.classList.contains('hidden'); hideAllPanels(); if (isHidden) panel.classList.remove('hidden'); }
function toggleRadar() { document.getElementById('radar-content').classList.toggle('hidden'); }

map.on('click', function(e) { 
    hideAllPanels(); document.getElementById('radar-content').classList.add('hidden'); 
    if (currentTool === 'patrol') {
        const desc = prompt("🚨 SIGNALEMENT SÉCURITÉ\nQuel type de patrouille ? (ex: Vigile, Maître-Chien, Voiture...)");
        if(desc) {
            const newData = { lat: e.latlng.lat, lng: e.latlng.lng, nom: "🚨 " + desc, date: new Date().toLocaleDateString('fr-FR'), statut: "patrol", personnes: ["Signalement Rapide"], notes: "Attention, présence de sécurité signalée ici." };
            fetch('/api/markers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newData) });
            toggleTool('patrol');
        }
    }
});

function setMapStyle(styleRequested) {
    map.removeLayer(carteClassique); map.removeLayer(carteSatellite); map.removeLayer(carteSombre); map.removeLayer(carteTopo); document.body.classList.remove('dark-mode');
    if (styleRequested === 'satellite') { map.addLayer(carteSatellite); if(!panicModeActif) afficherNotification("🛰️ Mode Satellite", "#27ae60"); } 
    else if (styleRequested === 'topo') { map.addLayer(carteTopo); if(!panicModeActif) afficherNotification("⛰️ Topographie", "#8e44ad"); } 
    else if (styleRequested === 'nuit') { map.addLayer(carteSombre); document.body.classList.add('dark-mode'); if(!panicModeActif) afficherNotification("🦇 Vision Nocturne", "#c0392b"); } 
    else { map.addLayer(carteClassique); if(!panicModeActif) afficherNotification("🗺️ Carte Classique", "#3498db"); }
    currentStyle = styleRequested; hideAllPanels(); 
}

function toggleStealth() { document.getElementById('stealth-screen').style.display = 'block'; if ("vibrate" in navigator) navigator.vibrate(100); }
document.getElementById('stealth-screen').addEventListener('dblclick', () => { document.getElementById('stealth-screen').style.display = 'none'; });

function localiserMoi() {
    hideAllPanels(); const gpsBtn = document.getElementById('btn-gps-dock'); gpsLocked = !gpsLocked;
    const hud = document.getElementById('tactical-hud');
    
    if (gpsLocked) { 
        afficherNotification("🔒 Verrouillage GPS : Suivi Auto", "#2ecc71"); gpsBtn.classList.add('locked'); 
        hud.classList.remove('hidden'); // Affiche le HUD
        map.locate({setView: true, maxZoom: 18, watch: true, enableHighAccuracy: true}); 
    } 
    else { 
        afficherNotification("🔓 GPS Déverrouillé", "#95a5a6"); gpsBtn.classList.remove('locked'); 
        hud.classList.add('hidden'); // Cache le HUD
        map.stopLocate(); 
    }
}

map.on('locationerror', function(e) { alert("❌ Erreur GPS : " + e.message); if(gpsLocked) localiserMoi(); });
map.on('locationfound', function(e) {
    // Gestion du Marqueur
    if (!userGPSMarker) { const radarIcon = L.divIcon({ className: 'gps-pulse-wrapper', html: `<div class="gps-pulse-container"><div class="gps-pulse-ring"></div><div class="gps-pulse-dot"></div></div>`, iconSize: [40, 40], iconAnchor: [20, 20] }); userGPSMarker = L.marker(e.latlng, {icon: radarIcon, zIndexOffset: 1000}).addTo(map); userGPSMarker.bindPopup("<b>🎯 Tu es ici</b>").openPopup(); } 
    else { userGPSMarker.setLatLng(e.latlng); }
    
    if (gpsLocked) {
        // MAJ du HUD Tactique
        document.getElementById('hud-coords').innerText = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
        document.getElementById('hud-acc').innerText = `${Math.round(e.accuracy)} m`;
        let vit = e.speed ? (e.speed * 3.6).toFixed(1) + " km/h" : "0.0 km/h";
        document.getElementById('hud-speed').innerText = vit;

        // Auto-Follow & Trace
        map.setView(e.latlng, map.getZoom(), { animate: true, duration: 0.5 }); traceGPS.push(e.latlng); polylineGPS.setLatLngs(traceGPS);
        
        // Radar
        if (!panicModeActif) {
            Object.values(marqueursSurCarte).forEach(markerObj => {
                const data = markerObj.marker.donnees;
                if (data.statut === 'garde' || data.statut === 'dangereux' || data.statut === 'patrol') {
                    const dist = map.distance(e.latlng, [data.lat, data.lng]);
                    if (dist < 150 && !markerObj.warned) {
                        afficherNotification(`⚠️ ALERTE : Tu es très proche de "${data.nom}" !`, "#e74c3c");
                        if ("vibrate" in navigator) navigator.vibrate([300, 150, 300, 150, 500]);
                        markerObj.warned = true; 
                    }
                }
            });
        }
    }
});

function sendRadio() { const input = document.getElementById('radio-input'); const txt = input.value.trim(); if(txt) { socket.emit('chat_message', txt); input.value = ''; } }
socket.on('chat_message', (msg) => {
    if(panicModeActif) return; 
    const time = new Date().toLocaleTimeString('fr-FR', {hour: '2-digit', minute:'2-digit'}); const box = document.getElementById('radio-messages');
    const msgDiv = document.createElement('div'); msgDiv.className = 'msg-line'; msgDiv.innerHTML = `<span class="msg-time">[${time}]</span> ${msg}`; box.appendChild(msgDiv); box.scrollTop = box.scrollHeight;
    if (document.getElementById('radio-panel').classList.contains('hidden')) { afficherNotification("💬 Nouveau message Radio", "#3498db"); }
    if (document.getElementById('ghost-mode-cb').checked) { setTimeout(() => { msgDiv.classList.add('ghost-out'); setTimeout(() => msgDiv.remove(), 1000); }, 30000); }
});

function triggerSOS() {
    hideAllPanels();
    if(confirm("🚨 DÉCLENCHER LE S.O.S ? (Position envoyée à l'équipe)")) {
        if (!navigator.geolocation) { alert("❌ GPS non supporté."); return; }
        navigator.geolocation.getCurrentPosition(pos => { socket.emit('sos_alert', { lat: pos.coords.latitude, lng: pos.coords.longitude }); afficherNotification("Signal envoyé !", "#c0392b"); }, err => { alert("❌ Erreur GPS : " + err.message); }, { enableHighAccuracy: true, timeout: 10000 });
    }
}
socket.on('sos_alert', (data) => {
    if(panicModeActif) return;
    document.getElementById('sos-screen').style.display = 'block'; afficherNotification(`🚨 URGENCE ! MEMBRE EN DANGER !`, '#c0392b'); if ("vibrate" in navigator) navigator.vibrate([1000, 500, 1000, 500, 1000]);
    const sosIcon = L.divIcon({ className: 'custom-pin-wrapper', html: `<div class="urbex-pin-container"><div class="urbex-pin bg-dangereux" style="width:40px; height:40px; border-color:yellow;"></div></div>`, iconSize: [50, 70], iconAnchor: [25, 70], popupAnchor: [0, -60] });
    L.marker([data.lat, data.lng], {icon: sosIcon, zIndexOffset: 9999}).addTo(map).bindPopup("<b style='color:red; font-size:16px;'>🚨 POSITION S.O.S !</b>").openPopup();
    map.setView([data.lat, data.lng], 18); setTimeout(() => { document.getElementById('sos-screen').style.display = 'none'; }, 10000);
});

map.on('contextmenu', function(e) { if (currentTool === 'add' || currentTool === 'patrol' || panicModeActif) return; socket.emit('ping_tactique', { lat: e.latlng.lat, lng: e.latlng.lng }); afficherNotification("📡 Ping tactique envoyé !", "#3498db"); });
socket.on('ping_tactique', (data) => {
    if(panicModeActif) return; afficherNotification("📍 Ping d'équipe reçu !", "#2980b9");
    const pingIcon = L.divIcon({ className: 'ping-pulse-wrapper', html: '<div class="ping-tactique-ring"></div>', iconSize: [60, 60], iconAnchor: [30, 30] });
    const tempPing = L.marker([data.lat, data.lng], {icon: pingIcon, zIndexOffset: 800}).addTo(map); setTimeout(() => { map.removeLayer(tempPing); }, 15000); 
});

function exportGPX() {
    let gpxContent = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="MapsForUrbex">\n';
    Object.values(marqueursSurCarte).forEach(markerObj => { const data = markerObj.marker.donnees; gpxContent += `  <wpt lat="${data.lat}" lon="${data.lng}">\n    <name>${data.nom}</name>\n    <desc>Statut: ${data.statut}</desc>\n  </wpt>\n`; });
    gpxContent += '</gpx>'; const blob = new Blob([gpxContent], { type: 'application/gpx+xml' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'urbex_spots.gpx'; document.body.appendChild(a); a.click(); document.body.removeChild(a); afficherNotification("💾 Export GPX réussi !", "#2ecc71");
}

function afficherNotification(message, couleur) {
    if(panicModeActif && couleur !== "#8e44ad") return; 
    const toast = document.createElement('div'); toast.innerText = message;
    toast.style.cssText = `position: fixed; top: 70px; left: 50%; transform: translateX(-50%) translateY(-50px); background: ${couleur}; color: white; padding: 10px 20px; border-radius: 30px; font-weight: bold; box-shadow: 0 4px 15px rgba(0,0,0,0.4); z-index: 4000; transition: all 0.3s ease; opacity: 0; text-align: center; font-size: 13px; pointer-events:none;`;
    document.body.appendChild(toast); setTimeout(() => { toast.style.transform = 'translateX(-50%) translateY(0)'; toast.style.opacity = '1'; }, 10);
    setTimeout(() => { toast.style.transform = 'translateX(-50%) translateY(-50px)'; toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
}

function rafraichirFiltresRadar() {
    if(panicModeActif) return;
    Object.values(marqueursSurCarte).forEach(markerObj => {
        const statut = markerObj.marker.donnees.statut || 'accessible';
        const estCoche = document.querySelector(`.filter-cb[value="${statut}"]`) ? document.querySelector(`.filter-cb[value="${statut}"]`).checked : true;
        if (estCoche) { if (!map.hasLayer(markerObj.marker)) map.addLayer(markerObj.marker); if (markerObj.cercle && !map.hasLayer(markerObj.cercle)) map.addLayer(markerObj.cercle); } 
        else { if (map.hasLayer(markerObj.marker)) map.removeLayer(markerObj.marker); if (markerObj.cercle && map.hasLayer(markerObj.cercle)) map.removeLayer(markerObj.cercle); }
    });
}
document.querySelectorAll('.filter-cb').forEach(cb => { cb.addEventListener('change', rafraichirFiltresRadar); });

// --- GESTION DU CACHE DE SURVIE ---
function rafraichirCacheLocal(points) {
    localStorage.setItem('urbex_backup_markers', JSON.stringify(points));
}

socket.on('marker_added', (nouveauPoint) => { 
    creerMarqueurSurCarte(nouveauPoint); afficherNotification(`📍 ${nouveauPoint.nom} ajouté`, '#1abc9c'); 
    chargerMarkers(true); // Force update du cache
});
socket.on('marker_edited', (pointModifie) => { 
    const markerObj = marqueursSurCarte[pointModifie.id]; 
    if (markerObj) { map.removeLayer(markerObj.marker); if (markerObj.cercle) map.removeLayer(markerObj.cercle); delete marqueursSurCarte[pointModifie.id]; creerMarqueurSurCarte(pointModifie); } 
    chargerMarkers(true);
});
socket.on('marker_deleted', (idSupprime) => { 
    const markerObj = marqueursSurCarte[idSupprime]; 
    if (markerObj) { map.removeLayer(markerObj.marker); if (markerObj.cercle) map.removeLayer(markerObj.cercle); delete marqueursSurCarte[idSupprime]; } 
    chargerMarkers(true);
});

// 💾 CHARGEMENT DES MARKERS AVEC FALLBACK HORS-LIGNE
async function chargerMarkers(isBackgroundUpdate = false) { 
    try {
        const response = await fetch('/api/markers'); 
        if (!response.ok) throw new Error("Réseau inaccessible");
        const points = await response.json(); 
        rafraichirCacheLocal(points); // Sauvegarde
        if (!isBackgroundUpdate) {
            points.forEach(point => creerMarqueurSurCarte(point)); 
        }
    } catch (error) {
        if (!isBackgroundUpdate) {
            afficherNotification("⚠️ Réseau KO. Chargement du cache de survie...", "#e74c3c");
            const backup = localStorage.getItem('urbex_backup_markers');
            if (backup) {
                const points = JSON.parse(backup);
                points.forEach(point => creerMarqueurSurCarte(point));
            } else {
                afficherNotification("❌ Aucun cache local disponible.", "#c0392b");
            }
        }
    }
}
chargerMarkers();

const statusText = document.getElementById('status-text');

function toggleTool(tool) {
    hideAllPanels(); currentTool = (currentTool === tool) ? null : tool;
    document.getElementById('btn-add').classList.toggle('active-add', currentTool === 'add'); document.getElementById('btn-edit').classList.toggle('active-edit', currentTool === 'edit');
    document.getElementById('btn-del').classList.toggle('active-del', currentTool === 'delete'); document.getElementById('btn-measure').classList.toggle('active-measure', currentTool === 'measure');
    document.getElementById('btn-patrol').classList.toggle('active-patrol', currentTool === 'patrol');
    
    if (currentTool !== 'measure') { pointMesure1 = null; if (ligneMesure) map.removeLayer(ligneMesure); }
    
    if(currentTool === 'add') statusText.innerText = "📍 Ajout : Clique sur la carte"; 
    else if(currentTool === 'edit') statusText.innerText = "✏️ Modif : Clique sur un spot"; 
    else if(currentTool === 'delete') statusText.innerText = "🗑️ Suppr : Clique sur un spot"; 
    else if(currentTool === 'measure') statusText.innerText = "📏 Mesure : Clique au départ"; 
    else if(currentTool === 'patrol') statusText.innerText = "👮 Patrouille : Clique pour signaler"; 
    else statusText.innerText = "👋 Prêt à explorer";
}

function creerIcone(statut) {
    let bgClass = 'bg-accessible'; if (statut === 'garde') bgClass = 'bg-garde'; if (statut === 'dangereux') bgClass = 'bg-dangereux'; if (statut === 'detruit') bgClass = 'bg-detruit';
    if (statut === 'patrol') bgClass = 'bg-patrol';
    if (statut === 'extraction') bgClass = 'bg-extraction'; // NOUVEAU
    return L.divIcon({ className: 'custom-pin-wrapper', html: `<div class="urbex-pin-container"><div class="urbex-pin ${bgClass}"></div></div>`, iconSize: [30, 42], iconAnchor: [15, 42], popupAnchor: [0, -40] });
}

function genererPopupHTML(data) {
    const peopleHtml = data.personnes && data.personnes.length > 0 ? `<div style="font-size:12px; opacity:0.8;">${data.personnes.join(', ')}</div>` : `<div style="font-size:12px; opacity:0.8;">Solo</div>`;
    
    let badgeText = "Accessible"; let badgeClass = "badge-accessible";
    if (data.statut === 'garde') { badgeText = "Gardé / Caméras"; badgeClass = "badge-garde"; } 
    if (data.statut === 'dangereux') { badgeText = "Dangereux / Ruine"; badgeClass = "badge-dangereux"; } 
    if (data.statut === 'detruit') { badgeText = "Détruit / Muré"; badgeClass = "badge-detruit"; }
    if (data.statut === 'patrol') { badgeText = "🚨 Sécurité Signalée"; badgeClass = "badge-dangereux"; }
    if (data.statut === 'extraction') { badgeText = "🚗 Point d'Extraction"; badgeClass = "badge-extraction"; } // NOUVEAU

    const notesHtml = data.notes && data.notes.trim() !== "" ? `<div style="background: rgba(0,0,0,0.1); padding: 8px; border-radius: 6px; font-size: 11px; margin-top: 8px; font-style: italic; border-left: 3px solid #3498db;">📝 ${data.notes}</div>` : '';
    const streetViewBtn = `<button class="btn-streetview" onclick="window.open('https://www.google.com/maps?layer=c&cbll=${data.lat},${data.lng}', '_blank')">👁️ Lancer Street View</button>`;

    return `
        <div style="min-width: 180px;">
            <div class="badge ${badgeClass}" style="display:inline-block; padding:3px 8px; border-radius:10px; font-size:10px; margin-bottom:5px; color:white;">${badgeText}</div>
            <h3 style="margin: 0 0 5px 0; font-size:15px; border-bottom:1px solid rgba(255,255,255,0.2); padding-bottom:5px;">${data.nom}</h3>
            <div style="font-size: 12px;">📅 ${data.date || 'Inconnue'}</div>
            <div style="margin-top:5px; font-size: 12px;">👥 <strong>Équipe :</strong></div>${peopleHtml}
            ${notesHtml}
            <div class="dynamic-distance" style="margin-top: 8px; font-size: 12px; color: #3498db; font-weight:bold;">📍 Calcul...</div>
            ${streetViewBtn}
        </div>`;
}

function creerMarqueurSurCarte(dataMarqueur) {
    if (marqueursSurCarte[dataMarqueur.id]) return;
    const marker = L.marker([dataMarqueur.lat, dataMarqueur.lng], { icon: creerIcone(dataMarqueur.statut || 'accessible') });
    if (!panicModeActif) { marker.addTo(map); }
    marker.donnees = dataMarqueur; marker.bindPopup(genererPopupHTML(dataMarqueur), { className: 'custom-popup', closeButton: false });

    marker.on('popupopen', function() {
        if (userGPSMarker) {
            const distanceMetres = map.distance(userGPSMarker.getLatLng(), marker.getLatLng()); let textDist = distanceMetres > 1000 ? (distanceMetres/1000).toFixed(2) + " km" : distanceMetres.toFixed(0) + " m";
            const distDiv = marker.getPopup().getElement().querySelector('.dynamic-distance'); if (distDiv) distDiv.innerHTML = `🚶 ${textDist} de toi`;
        }
    });

    let dangerCircle = null;
    if (dataMarqueur.statut === 'garde' || dataMarqueur.statut === 'dangereux' || dataMarqueur.statut === 'patrol') {
        const estGarde = dataMarqueur.statut === 'garde'; 
        dangerCircle = L.circle([dataMarqueur.lat, dataMarqueur.lng], { color: estGarde ? '#f39c12' : '#e74c3c', fillColor: estGarde ? '#f39c12' : '#e74c3c', fillOpacity: 0.15, radius: estGarde ? 150 : 100 });
        if (!panicModeActif) { dangerCircle.addTo(map); dangerCircle.bringToBack(); }
    }
    marqueursSurCarte[dataMarqueur.id] = { marker: marker, cercle: dangerCircle };

    marker.on('click', async function() {
        if (currentTool === 'delete') { marker.closePopup(); if (confirm(`Supprimer "${marker.donnees.nom}" ?`)) fetch(`/api/markers/${marker.donnees.id}`, { method: 'DELETE' }); } 
        else if (currentTool === 'edit') {
            marker.closePopup(); markerEnCoursEdition = marker;
            document.getElementById('modal-title').innerText = "Modifier le Spot"; document.getElementById('point-name').value = marker.donnees.nom; document.getElementById('point-date').value = marker.donnees.date === "Inconnue" ? "" : marker.donnees.date; document.getElementById('point-status').value = marker.donnees.statut || 'accessible';
            document.getElementById('point-notes').value = marker.donnees.notes || "";
            const pList = document.getElementById('people-list'); pList.innerHTML = '';
            if (!marker.donnees.personnes || marker.donnees.personnes.length === 0) { pList.innerHTML = '<input type="text" class="person-input" placeholder="Personne 1">'; } 
            else { marker.donnees.personnes.forEach((p, index) => { const input = document.createElement('input'); input.type = 'text'; input.className = 'person-input'; input.placeholder = `Personne ${index + 1}`; input.value = p; pList.appendChild(input); }); }
            document.getElementById('modal').style.display = 'flex';
        } else { map.flyTo([marker.donnees.lat, marker.donnees.lng], 17, { animate: true, duration: 0.6 }); }
    });
}

map.on('click', function(e) {
    if (currentTool === 'add') { tempLatLng = e.latlng; document.getElementById('modal-title').innerText = "Nouveau Spot"; document.getElementById('modal').style.display = 'flex'; } 
    else if (currentTool === 'measure') {
        if (!pointMesure1) { pointMesure1 = e.latlng; statusText.innerText = "📏 Clique maintenant sur l'arrivée."; afficherNotification("Point de départ validé.", "#3498db"); } 
        else {
            const pointMesure2 = e.latlng; const distanceMetres = map.distance(pointMesure1, pointMesure2).toFixed(0);
            if (ligneMesure) map.removeLayer(ligneMesure);
            ligneMesure = L.polyline([pointMesure1, pointMesure2], { color: '#e74c3c', dashArray: '8, 8', weight: 3 }).addTo(map);
            ligneMesure.bindPopup(`<div style="text-align:center;"><strong style="color:#e74c3c; font-size:16px;">${distanceMetres} m</strong></div>`, {className: 'custom-popup', closeOnClick: false}).openPopup();
            pointMesure1 = null; statusText.innerText = "📏 Nouveau départ ?";
        }
    }
});

document.getElementById('btn-add-person').addEventListener('click', () => { const list = document.getElementById('people-list'); if (list.children.length < 15) { const input = document.createElement('input'); input.type = 'text'; input.className = 'person-input'; input.placeholder = `Personne ${list.children.length + 1}`; list.appendChild(input); } });
document.getElementById('btn-cancel').addEventListener('click', () => { document.getElementById('modal').style.display = 'none'; document.getElementById('point-name').value = ''; document.getElementById('point-notes').value = ''; document.getElementById('point-date').value = ''; document.getElementById('point-status').value = 'accessible'; document.getElementById('people-list').innerHTML = '<input type="text" class="person-input" placeholder="Personne 1">'; tempLatLng = null; markerEnCoursEdition = null; });
document.getElementById('btn-confirm').addEventListener('click', () => {
    const name = document.getElementById('point-name').value.trim() || "Spot"; 
    const date = document.getElementById('point-date').value || "Inconnue"; 
    const statut = document.getElementById('point-status').value; 
    const notes = document.getElementById('point-notes').value.trim();

    let peopleNames = []; document.querySelectorAll('.person-input').forEach(input => { if (input.value.trim() !== '') peopleNames.push(input.value.trim()); });
    
    if (markerEnCoursEdition) { 
        const updatedData = { nom: name, date: date, statut: statut, personnes: peopleNames, notes: notes }; 
        fetch(`/api/markers/${markerEnCoursEdition.donnees.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedData) }); 
    } else { 
        const newData = { lat: tempLatLng.lat, lng: tempLatLng.lng, nom: name, date: date, statut: statut, personnes: peopleNames, notes: notes }; 
        fetch('/api/markers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newData) }); 
    }
    document.getElementById('btn-cancel').click();
});